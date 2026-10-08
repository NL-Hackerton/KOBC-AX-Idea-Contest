import { getMode } from './api'

export default function App() {
  return (
    <main style={{ padding: 24 }}>
      <h1>K-JIT</h1>
      <p className="muted">데이터 상태: {getMode() === 'live' ? '실시간' : '저장본'}</p>
    </main>
  )
}
