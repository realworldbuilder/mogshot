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
	return entry, items
end

-- The same record as one line to paste into the page. No "|", which the game eats.
local function code(entry)
	local gear, choices = {}, {}
	for _, slot in ipairs(SLOTS) do
		local id = entry.gear and entry.gear[slot[1]]
		if id then gear[#gear + 1] = slot[1] .. ":" .. id end
	end
	local options = {}
	for option in pairs(entry.choices or {}) do options[#options + 1] = option end
	table.sort(options)
	for _, option in ipairs(options) do choices[#choices + 1] = option .. ":" .. entry.choices[option] end
	-- Names are percent-encoded so no separator can appear in one.
	local names = {}
	for _, slot in ipairs(SLOTS) do
		local id = entry.gear and entry.gear[slot[1]]
		local item = id and entry.items and entry.items[id]
		if item then
			local safe = item.name:gsub("[^%w]", function(c) return ("%%%02X"):format(c:byte()) end)
			names[#names + 1] = id .. ":" .. (item.quality or 1) .. ":" .. safe
		end
	end
	local fields = {
		"MOG1", key() or "", entry.race or "", entry.raceId or "", (entry.sex or 2) - 2,
		entry.classId or "", entry.class or "", entry.t or "", table.concat(gear, ","), table.concat(choices, ","),
		table.concat(names, ","),
	}
	return (table.concat(fields, ";"):gsub("|", ""))
end

-- A box with the code selected, ready for Cmd+C or Ctrl+C.
local copyFrame, copyBox
local function showCode(text)
	if not copyFrame then
		copyFrame = CreateFrame("Frame", "MogshotCopy", UIParent, "BackdropTemplate")
		copyFrame:SetSize(520, 110)
		copyFrame:SetPoint("CENTER")
		copyFrame:SetFrameStrata("FULLSCREEN_DIALOG")
		copyFrame:SetMovable(true)
		copyFrame:EnableMouse(true)
		copyFrame:RegisterForDrag("LeftButton")
		copyFrame:SetScript("OnDragStart", copyFrame.StartMoving)
		copyFrame:SetScript("OnDragStop", copyFrame.StopMovingOrSizing)
		copyFrame:SetBackdrop({
			bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
			edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
			tile = true, tileSize = 16, edgeSize = 16,
			insets = { left = 4, right = 4, top = 4, bottom = 4 },
		})
		copyFrame:SetBackdropColor(0.05, 0.05, 0.07, 0.97)
		tinsert(UISpecialFrames, "MogshotCopy")
		local title = copyFrame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		title:SetPoint("TOPLEFT", 14, -12)
		local copyKey = (IsMacClient and IsMacClient()) and "Cmd+C" or "Ctrl+C"
		title:SetText("Your Mogshot code is selected: press " .. copyKey .. ", then Esc. Paste it into the page.")
		local close = CreateFrame("Button", nil, copyFrame, "UIPanelCloseButton")
		close:SetPoint("TOPRIGHT", -4, -4)
		copyBox = CreateFrame("EditBox", "MogshotCopyBox", copyFrame)
		copyBox:SetMultiLine(true)
		copyBox:SetAutoFocus(false)
		copyBox:SetFontObject(ChatFontNormal)
		copyBox:SetMaxLetters(0)
		copyBox:SetPoint("TOPLEFT", 14, -36)
		copyBox:SetPoint("BOTTOMRIGHT", -14, 12)
		copyBox:SetScript("OnEscapePressed", function() copyFrame:Hide() end)
	end
	copyBox:SetText(text)
	copyFrame:Show()
	copyBox:SetFocus()
	copyBox:HighlightText()
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
			if entry then pcall(captureLook, entry) end
		end)
	else
		pcall(capture)
	end
end)

SLASH_MOGSHOT1 = "/mogshot"
SlashCmdList["MOGSHOT"] = function()
	local ok, entry, items = pcall(capture)
	if not ok or not entry then
		say("could not read this character: " .. tostring(entry))
		return
	end
	local looks = 0
	for _ in pairs(entry.choices or {}) do looks = looks + 1 end
	say(("captured %s: %d items, %d appearance choices%s. The file is saved on /reload or logout; the code below works now."):format(
		key() or "?", items, looks, looks == 0 and " (open a barber to capture the look)" or ""))
	showCode(code(entry))
end
