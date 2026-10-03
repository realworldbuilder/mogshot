-- Mogshot: remember who each character is and what they wear, for the Mogshot page.
--
-- The page (https://realworldbuilder.github.io/mogshot/) reads the file this addon saves,
-- WTF/Account/<account>/SavedVariables/Mogshot.lua, when the game folder is dropped onto
-- it, so nothing has to be copied by hand. The game writes that file on /reload and on
-- logout. /mogshot also shows a code to paste into the page, for when that is easier.
--
-- Plain addon API only. Nothing leaves the game.

local ADDON = ...
local VERSION = 1

-- Inventory slots the page can draw, by Mogshot's slot names.
local SLOTS = {
	{ "head", 1 }, { "shoulder", 3 }, { "shirt", 4 }, { "chest", 5 }, { "waist", 6 }, { "legs", 7 },
	{ "feet", 8 }, { "wrist", 9 }, { "hands", 10 }, { "back", 15 }, { "mainHand", 16 }, { "offHand", 17 },
	{ "ranged", 18 }, { "tabard", 19 },
}

local function say(text)
	print("|cfff0b232Mogshot|r: " .. text)
end

local function key()
	local name = UnitName("player")
	local realm = GetRealmName() or ""
	if not name then return nil end
	return name .. "-" .. realm
end

local function record()
	MogshotDB = MogshotDB or {}
	local k = key()
	if not k then return nil end
	local entry = MogshotDB[k] or {}
	MogshotDB[k] = entry
	return entry
end

-- The appearance choices the barber shows, as the game's option and choice ids. Only
-- available while the barber window is open; kept from the last visit otherwise.
local function captureLook(entry)
	if not (C_BarberShop and C_BarberShop.GetAvailableCustomizations) then return 0 end
	local ok, categories = pcall(C_BarberShop.GetAvailableCustomizations)
	if not ok or type(categories) ~= "table" then return 0 end
	local choices, count = {}, 0
	local function walk(category)
		for _, option in ipairs(category.options or {}) do
			local current = option.choices and option.currentChoiceIndex and option.choices[option.currentChoiceIndex]
			if option.id and current and current.id then
				choices[option.id] = current.id
				count = count + 1
			end
		end
		for _, sub in ipairs(category.subcategories or {}) do walk(sub) end
	end
	for _, category in ipairs(categories) do walk(category) end
	if count > 0 then entry.choices = choices end
	return count
end

-- `undressing` says the player just changed what they wear, so finding nothing worn is real.
-- At other moments (a loading screen, logging out) the game may report nothing worn; what
-- was captured before is kept then.
local function capture(undressing)
	local entry = record()
	if not entry then return end
	local _, raceFile, raceId = UnitRace("player")
	local _, classFile, classId = UnitClass("player")
	entry.v = VERSION
	entry.t = entry.t or time()
	entry.race = raceFile
	entry.raceId = raceId
	entry.sex = UnitSex("player") -- 2 male, 3 female
	entry.class = classFile
	entry.classId = classId
	-- The game files have no name for many items (the server supplies them), so pass them along.
	local gear, named, items = {}, {}, 0
	for _, slot in ipairs(SLOTS) do
		local id = GetInventoryItemID("player", slot[2])
		if id and id > 0 then
			gear[slot[1]] = id
			items = items + 1
			local name, _, quality
			if GetItemInfo then name, _, quality = GetItemInfo(id) end
			if not name and C_Item and C_Item.GetItemNameByID then name = C_Item.GetItemNameByID(id) end
			if not quality and C_Item and C_Item.GetItemQualityByID then quality = C_Item.GetItemQualityByID(id) end
			if name then named[id] = { name = name, quality = quality or 1 } end
		end
	end
	if items > 0 or undressing or not entry.gear then
		entry.gear = gear
		entry.items = named
		entry.t = time()
	end
	-- The look, wherever the game is willing to tell it (certainly at a barber).
	pcall(captureLook, entry)
	return entry, items
end

-- One capital letter per slot in the code; the item id follows in base 36.
local LETTERS = {
	head = "H", shoulder = "S", back = "B", chest = "C", shirt = "T", tabard = "A", wrist = "W", hands = "G",
	waist = "N", legs = "P", feet = "F", mainHand = "M", offHand = "O", ranged = "R",
}

local DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
local function base36(n)
	n = math.floor(n)
	if n <= 0 then return "0" end
	local out = ""
	while n > 0 do
		local d = n % 36
		out = DIGITS:sub(d + 1, d + 1) .. out
		n = (n - d) / 36
	end
	return out
end

-- The record as a short code to paste into the page:
-- MOG2;Name-Realm;race;sex;class;gear;choices. No "|", which the game eats.
local function code(entry)
	local gear, choices = {}, {}
	for _, slot in ipairs(SLOTS) do
		local id = entry.gear and entry.gear[slot[1]]
		if id then gear[#gear + 1] = LETTERS[slot[1]] .. base36(id) end
	end
	local options = {}
	for option in pairs(entry.choices or {}) do options[#options + 1] = option end
	table.sort(options)
	for _, option in ipairs(options) do choices[#choices + 1] = base36(entry.choices[option]) end
	local fields = {
		"MOG2", key() or "", entry.raceId or entry.race or "", (entry.sex or 2) - 2, entry.classId or "",
		table.concat(gear), table.concat(choices, "."),
	}
	return (table.concat(fields, ";"):gsub("|", ""))
end

-- A box in the middle of the screen with the code selected, ready for Cmd+C or Ctrl+C.
local copyFrame, copyBox
local function buildCopyBox()
	-- Older clients have no backdrop template; the box works without the border.
	local template = BackdropTemplateMixin and "BackdropTemplate" or nil
	local f = CreateFrame("Frame", "MogshotCopy", UIParent, template)
	f:SetSize(540, 86)
	f:SetPoint("CENTER", 0, 120)
	f:SetFrameStrata("FULLSCREEN_DIALOG")
	f:SetMovable(true)
	f:EnableMouse(true)
	f:RegisterForDrag("LeftButton")
	f:SetScript("OnDragStart", f.StartMoving)
	f:SetScript("OnDragStop", f.StopMovingOrSizing)
	if f.SetBackdrop then
		f:SetBackdrop({
			bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
			edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
			tile = true, tileSize = 16, edgeSize = 16,
			insets = { left = 4, right = 4, top = 4, bottom = 4 },
		})
		f:SetBackdropColor(0.05, 0.05, 0.07, 0.97)
	else
		local bg = f:CreateTexture(nil, "BACKGROUND")
		bg:SetAllPoints()
		bg:SetColorTexture(0.05, 0.05, 0.07, 0.97)
	end
	tinsert(UISpecialFrames, "MogshotCopy")
	local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	title:SetPoint("TOPLEFT", 14, -12)
	local copyKey = (IsMacClient and IsMacClient()) and "Cmd+C" or "Ctrl+C"
	title:SetText("Mogshot code, selected: press " .. copyKey .. ", then Esc. Paste it into the page.")
	local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", -2, -2)
	-- One line: the whole code is selected even where it runs past the edge.
	local box = CreateFrame("EditBox", "MogshotCopyBox", f)
	box:SetAutoFocus(false)
	box:SetFontObject(ChatFontNormal)
	box:SetMaxLetters(0)
	box:SetSize(510, 24)
	box:SetPoint("BOTTOMLEFT", 14, 14)
	box:SetScript("OnEscapePressed", function() f:Hide() end)
	box:SetScript("OnEnterPressed", function() f:Hide() end)
	copyFrame, copyBox = f, box
end

-- True if the box is on screen with the code in it.
local function showCode(text)
	if not copyFrame then
		local ok = pcall(buildCopyBox)
		if not ok or not copyBox then copyFrame, copyBox = nil, nil return false end
	end
	copyBox:SetText(text)
	copyBox:SetCursorPosition(0)
	copyFrame:Show()
	copyBox:SetFocus()
	copyBox:HighlightText()
	return true
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
if C_BarberShop then
	frame:RegisterEvent("BARBER_SHOP_OPEN")
	frame:RegisterEvent("BARBER_SHOP_APPEARANCE_APPLIED")
end

local pending = false
frame:SetScript("OnEvent", function(_, event)
	if event == "PLAYER_EQUIPMENT_CHANGED" then
		-- Changing a whole set fires once per piece; capture once, a moment later.
		if pending then return end
		pending = true
		C_Timer.After(1, function()
			pending = false
			pcall(capture, true)
		end)
	elseif event == "BARBER_SHOP_OPEN" or event == "BARBER_SHOP_APPEARANCE_APPLIED" then
		C_Timer.After(0.5, function()
			local entry = record()
			if not entry then return end
			local ok, count = pcall(captureLook, entry)
			if ok and count and count > 0 then
				say(("captured %d appearance choices. Leave the barber, type /reload, and give the page the folder again."):format(count))
			else
				say("the barber is open but the look could not be read.")
			end
		end)
	else
		pcall(capture)
	end
end)

SLASH_MOGSHOT1 = "/mogshot"
SlashCmdList["MOGSHOT"] = function(message)
	if message and message:lower():match("^%s*spot") then
		-- Where the character stands, as a line to paste into the page's Place box.
		-- The game gives addons no position inside dungeons and raids, and never the height.
		local x, y, _, map = UnitPosition("player")
		if not x then
			say("the game does not tell addons the position in here. Try outdoors or in a city.")
			return
		end
		say(("spot %d %.1f %.1f %d  (paste this line into Place on the page)"):format(map, x, y, math.floor(math.deg(GetPlayerFacing() or 0) + 0.5)))
		return
	end
	local ok, entry, items = pcall(capture)
	if not ok or not entry then
		say("could not read this character: " .. tostring(entry))
		return
	end
	MogshotDB._probe = nil -- left by an earlier version
	local looks = 0
	for _ in pairs(entry.choices or {}) do looks = looks + 1 end
	say(("captured %s: %d items, %d appearance choices."):format(key() or "?", items, looks))
	if looks == 0 then
		-- The game tells addons what a character looks like only inside the barber window.
		if C_BarberShop and C_BarberShop.GetAvailableCustomizations then
			say("skin, hair and face are not captured yet. Sit in a barber chair once (no need to change anything) and they will be.")
		else
			say("this game version cannot tell addons the skin, hair and face. Set them on the page once; it remembers them for this character.")
		end
	end
	local text = code(entry)
	if showCode(text) then
		say("the code is in the box in the middle of the screen. Copy it and paste it into the page. Or /reload and give the page the folder again.")
	elseif ChatFrame_OpenChat then
		-- The box could not be made on this client: the chat line can be copied too.
		ChatFrame_OpenChat(text)
		say("the code is in the chat line, selected. Copy it, clear the line, and paste it into the page.")
		local edit = ChatEdit_GetActiveWindow and ChatEdit_GetActiveWindow()
		if edit and edit.HighlightText then edit:HighlightText() end
	else
		say("the code could not be shown. /reload and give the page the folder again.")
	end
end
