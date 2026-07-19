export interface FilePickerNavigator {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

function browserNavigator(): FilePickerNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/**
 * iPadOS 13+ can identify itself as a desktop Mac. Apple mobile devices use a
 * system document picker that may disable unknown custom extensions, so both
 * the mobile UA and the MacIntel + multitouch disguise must be recognized.
 */
export function usesAppleTouchFilePicker(value:FilePickerNavigator|undefined=browserNavigator()){
  if(!value)return false;
  return /iPad|iPhone|iPod/i.test(value.userAgent??'')
    || value.platform==='MacIntel'&&Number(value.maxTouchPoints??0)>1;
}

/**
 * `accept` is a convenience filter, not a validation boundary. On iOS/iPadOS
 * omit it for inputs containing app-specific extensions and let the existing
 * parser validate the selected file without changing its original filename.
 */
export function compatibleFileAccept(accept:string,value?:FilePickerNavigator){
  return usesAppleTouchFilePicker(value??browserNavigator())?undefined:accept;
}
