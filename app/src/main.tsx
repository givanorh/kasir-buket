import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { isNative } from './lib/session';

createRoot(document.getElementById('root')!).render(<App />);

if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
