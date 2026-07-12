import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlaygroundApp } from './PlaygroundApp';
import '../App.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element found');

createRoot(root).render(
  <StrictMode>
    <PlaygroundApp />
  </StrictMode>,
);
