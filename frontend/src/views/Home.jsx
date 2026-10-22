import Training from './Training.jsx'
import Today from './Today.jsx'
import { useStore } from '../store/useStore.js'
import { healthOn } from '../lib/modules.js'

// Home. Training only (every other module switched off, lib/modules.js): the training Home as it
// always was (views/Training.jsx with every card). With modules on: Today, the day across them
// (views/Today.jsx); the training cards are in the Training tab.
export default function Home() {
  const on = useStore(s => healthOn(s.S))
  return on ? <Today /> : <Training home />
}
