// The modules beside training (Settings → Modules): each can be switched off, which only hides
// it — its data stays. With all of them off the app is the training app it started as: the old
// tab bar and the old Home.
//
//   S.modules { habits, food, sleep, meds, exams, water }  — true or absent = on
export const MODULES = ['habits', 'food', 'sleep', 'meds', 'exams', 'water']

// Water came after the others: never set, it follows them, so a profile with every other module
// switched off stays the training app it chose to be.
const FIRST = ['habits', 'food', 'sleep', 'meds', 'exams']

/** Whether module `key` is on (on unless switched off). */
export const moduleOn = (S, key) => {
  if (key === 'water' && S?.modules?.water === undefined) return FIRST.some(k => S?.modules?.[k] !== false)
  return S?.modules?.[key] !== false
}
/** Whether any module beside training is on: the new navigation, or the training-only one. */
export const healthOn = S => MODULES.some(k => moduleOn(S, k))
