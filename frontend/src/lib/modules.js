// The modules beside training (Settings → Modules): each can be switched off, which only hides
// it — its data stays. With all of them off the app is the training app it started as: the old
// tab bar and the old Home.
//
//   S.modules { habits, food, sleep, meds, exams }  — true or absent = on
export const MODULES = ['habits', 'food', 'sleep', 'meds', 'exams']

/** Whether module `key` is on (on unless switched off). */
export const moduleOn = (S, key) => S?.modules?.[key] !== false
/** Whether any module beside training is on: the new navigation, or the training-only one. */
export const healthOn = S => MODULES.some(k => moduleOn(S, k))
