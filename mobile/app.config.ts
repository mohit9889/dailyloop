import base from './app.json';
const variant=process.env.APP_VARIANT||'development';
const production=variant==='production';
export default {
 ...base.expo,
 name:production?'DailyLoop':'DailyLoop Preview',
 scheme:production?'dailyloop':'dailyloop-preview',
 ios:{...base.expo.ios,bundleIdentifier:production?'com.dailyloop.app':'com.dailyloop.preview'},
 android:{...base.expo.android,package:production?'com.dailyloop.app':'com.dailyloop.preview',versionCode:1},
};
