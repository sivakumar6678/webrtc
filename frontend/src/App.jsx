import { Routes, Route } from 'react-router-dom'
import DesktopPage from './components/DesktopPage'
import JoinPage from './components/JoinPage'
import './App.css'

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<DesktopPage />} />
        <Route path="/join/:roomId" element={<JoinPage />} />
      </Routes>
    </div>
  )
}

export default App
