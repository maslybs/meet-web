import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

if (typeof window !== 'undefined') {
  const sourceKey = 'camera-mother-name';
  const targetKey = 'meet-web-name';
  try {
    const storedName = window.localStorage.getItem(sourceKey);
    const sanitizedName = storedName?.trim();
    if (sanitizedName && !window.localStorage.getItem(targetKey)) {
      window.localStorage.setItem(targetKey, sanitizedName);
    }
  } catch (error) {
    console.warn('Не вдалося синхронізувати імʼя користувача з localStorage.', error);
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
