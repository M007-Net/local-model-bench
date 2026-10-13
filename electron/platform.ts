// Desktop and web builds share the controller, database and benchmark workers.
// The web build substitutes platform-web.ts at this single boundary.
export {app,BrowserWindow,ipcMain,dialog,clipboard,safeStorage,shell} from 'electron';
export const isWeb=false;
export function publish(_name:string,_value:unknown){}
export async function startWebPanel(){throw Error('Web transport is not included in the desktop build.');}
