// The version the window shows comes from package.json, through the define in vite.config.ts,
// so it is the same number the installer is named after and cannot drift from it. It did
// drift: 1.9.0 was packaged and installed while its own sidebar still read "1.8.0", because
// the number was typed into the markup by hand.
// `typeof` on an identifier that was never declared is safe in JavaScript, so a bundle built
// without the define — a test importing this file, for instance — says so rather than throwing.
declare const __APP_VERSION__:string;
export const appVersion=typeof __APP_VERSION__==='string'?__APP_VERSION__:'development build';
