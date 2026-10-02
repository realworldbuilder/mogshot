import { render } from 'preact';
import { App } from './app/App';
import './app/style.css';

render(<App />, document.querySelector('#app')!);
