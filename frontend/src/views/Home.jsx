import Training from './Training.jsx'
import { useStore } from '../store/useStore.js'
import { healthOn } from '../lib/modules.js'

// Home. Training only (every other module switched off, lib/modules.js): the training Home as it
// always was (views/Training.jsx with every card). With modules on, the day across them; the
// training cards moved to the Training tab.
export default function Home() {
  const on = useStore(s => healthOn(s.S))
  if (!on) return <Training home />
  return <Training home sections={['health', 'weight']} />
}
