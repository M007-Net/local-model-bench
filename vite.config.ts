import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
// The window prints the same version the installer is named after, taken from one place, so
// the two cannot disagree the way they did when the number was typed into the markup.
const { version } = JSON.parse(readFileSync('./package.json','utf8'));
export default defineConfig({plugins:[react()],base:'./',server:{host:'127.0.0.1'},define:{__APP_VERSION__:JSON.stringify(version)}});