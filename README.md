# Exbotix Orderbook Component

Real-time orderbook component powered by KuCoin APIs for displaying live trading data.

## Features

- Real-time WebSocket updates from KuCoin
- Adaptive precision levels for each trading pair
- Support for any KuCoin trading pair
- Smart number formatting (handles low-value coins like PEPE)
- Dark-themed UI matching Exbotix design
- Displays 8 bid/ask levels by default

## Quick Integration Guide

### 1. Copy Component File

Copy this file to your website project:
```
src/components/Orderbook.jsx
```

### 2. Install Dependencies

```bash
npm install react react-dom
```

### 3. Configure Vite Proxy (Required)

Add to your `vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    cors: true,
    proxy: {
      '/api': {
        target: 'https://api.kucoin.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            proxyReq.setHeader('Origin', 'https://api.kucoin.com');
          });
        }
      }
    }
  }
})
```

**Note:** For production, configure your backend to proxy KuCoin API requests.

### 4. Use the Component

```jsx
import Orderbook from './components/Orderbook'

function TradingPage() {
  return (
    <div>
      <Orderbook initialSymbol="BTC-USDT" depth={8} />
    </div>
  )
}
```

## Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialSymbol` | string | `'BTC-USDT'` | Trading pair (must be valid KuCoin symbol) |
| `depth` | number | `8` | Number of bid/ask levels to display |

## Usage Examples

**Bitcoin:**
```jsx
<Orderbook initialSymbol="BTC-USDT" depth={8} />
```

**Ethereum:**
```jsx
<Orderbook initialSymbol="ETH-USDT" depth={8} />
```

**Low-Value Coins:**
```jsx
<Orderbook initialSymbol="PEPE-USDT" depth={8} />
```

## Supported Trading Pairs

Any valid KuCoin trading pair:
- BTC-USDT
- ETH-USDT
- SOL-USDT
- PEPE-USDT
- DOGE-USDT
- And 600+ more pairs

Check [KuCoin Markets](https://www.kucoin.com/markets) for the full list.

## Styling

Component uses Tailwind CSS. Make sure Tailwind is configured:

```bash
npm install -D tailwindcss postcss autoprefixer @tailwindcss/postcss
```

## How It Works

1. Fetches symbol info to determine precision levels
2. Connects to KuCoin WebSocket for real-time updates
3. Displays initial orderbook snapshot
4. Updates in real-time (500ms refresh rate)
5. Precision dropdown adapts to each trading pair

## Production Deployment

Replace Vite proxy with a backend API proxy or configure CORS headers on your server to forward requests to `https://api.kucoin.com`.

## Component Features

- **Adaptive Formatting:** Automatically adjusts decimal places based on price magnitude
- **Fixed Last Price:** Last price stays constant regardless of precision selection
- **Smart Grouping:** Bids round down, asks round up to maintain spread
- **Live Updates:** Real-time WebSocket connection with auto-reconnect
- **Responsive Design:** Works on all screen sizes
