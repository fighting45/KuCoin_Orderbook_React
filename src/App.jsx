import Orderbook from './components/Orderbook';
import './App.css';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0e27] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Exbotix Exchange
          </h1>
          <p className="text-gray-400">Real-time Order Book powered by KuCoin</p>
        </div>

        <Orderbook initialSymbol="BTC-USDT" depth={8} />
      </div>
    </div>
  );
}

export default App;
