import { Routes, Route } from 'react-router-dom'
import AgentConsole from '../pages/ai/AgentConsole'
import HelpCenter from '../pages/system/HelpCenter'
import Tutorial from '../pages/ai/Tutorial'
import NavAssistant from '../pages/ai/NavAssistant'

export default function AIModule() {
  return (
    <Routes>
      <Route path="help" element={<HelpCenter />} />
      <Route path="agent" element={<AgentConsole />} />
      <Route path="tutorial" element={<Tutorial />} />
      <Route path="nav-assistant" element={<NavAssistant />} />
    </Routes>
  )
}
