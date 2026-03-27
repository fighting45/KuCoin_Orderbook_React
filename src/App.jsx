import Orderbook from './components/Orderbook';
import './App.css';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0e27] flex items-center justify-center p-4">
      <Orderbook initialSymbol="BTC-USDT" depth={8} />
    </div>
  );
}

export default App;
