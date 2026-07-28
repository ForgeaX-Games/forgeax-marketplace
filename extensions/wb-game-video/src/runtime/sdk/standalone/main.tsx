import { createRoot } from 'react-dom/client'
import { RuntimeGameApp } from '../react/RuntimeGameApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount point')

createRoot(root).render(<RuntimeGameApp />)
