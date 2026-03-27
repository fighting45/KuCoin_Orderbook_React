import { useState, useEffect, useRef } from 'react';

const Orderbook = ({ initialSymbol = 'BTC-USDT', depth = 8 }) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [symbolInput, setSymbolInput] = useState(initialSymbol);
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [lastPrice, setLastPrice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [precision, setPrecision] = useState(null);
  const [precisionOptions, setPrecisionOptions] = useState([]);
  const [tickSize, setTickSize] = useState(null);
  const [orderbookUpdateTrigger, setOrderbookUpdateTrigger] = useState(0);
  const wsRef = useRef(null);
  const orderBookRef = useRef({ bids: {}, asks: {} });
  const actualLastPriceRef = useRef(null); // Store actual last price (not affected by precision)

  // Fetch symbol information and set up precision levels
  useEffect(() => {
    const fetchSymbolInfo = async () => {
      try {
        console.log('Fetching symbol info...');
        const response = await fetch(`/api/api/v1/symbols`);
        const data = await response.json();
        console.log('Symbol API response:', data.code);

        if (data.code === '200000') {
          // Find the specific symbol
          const symbolInfo = data.data.find(s => s.symbol === symbol);

          if (symbolInfo) {
            const baseIncrement = parseFloat(symbolInfo.baseIncrement);
            const priceIncrement = parseFloat(symbolInfo.priceIncrement);

            // Set tick size
            setTickSize(priceIncrement);

            // Generate precision levels based on tick size (like KuCoin does)
            // Use smart multipliers: 1x, 10x, 100x of tick size
            // Stop when precision becomes too large relative to tick size
            const multipliers = [1, 10, 100, 1000];
            const precisions = multipliers
              .map(m => priceIncrement * m)
              .filter(p => p <= 1000); // Cap at 1000 to match KuCoin's behavior

            setPrecisionOptions(precisions);
            setPrecision(priceIncrement); // Set default to tick size

            console.log('Symbol Info:', {
              symbol: symbolInfo.symbol,
              priceIncrement,
              baseIncrement,
              precisions
            });
          }
        }
      } catch (error) {
        console.error('Error fetching symbol info:', error);
        // Fallback to default values
        setPrecisionOptions([0.01, 0.1, 1, 10, 100]);
        setPrecision(0.01);
      }
    };

    fetchSymbolInfo();
  }, [symbol]);

  useEffect(() => {
    let connectId = null;
    let pingInterval = null;

    const connectWebSocket = async () => {
      try {
        console.log('Connecting to WebSocket...');
        // Get public token from KuCoin
        const response = await fetch('/api/api/v1/bullet-public', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        console.log('WebSocket token response:', data.code);

        if (data.code !== '200000') {
          console.error('Failed to get token:', data);
          return;
        }

        const token = data.data.token;
        const endpoint = data.data.instanceServers[0].endpoint;
        connectId = Date.now();

        const wsUrl = `${endpoint}?token=${token}&connectId=${connectId}`;
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);

          // Subscribe to Level 2 Market Data (with small delay to ensure connection is ready)
          setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              const subscribeMsg = {
                id: connectId,
                type: 'subscribe',
                topic: `/market/level2:${symbol}`,
                privateChannel: false,
                response: true
              };
              wsRef.current.send(JSON.stringify(subscribeMsg));
            }
          }, 100);

          // Send ping every 20 seconds to keep connection alive
          pingInterval = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                id: Date.now(),
                type: 'ping'
              }));
            }
          }, 20000);
        };

        wsRef.current.onmessage = async (event) => {
          const message = JSON.parse(event.data);

          // Handle welcome message
          if (message.type === 'welcome') {
            console.log('Received welcome message');
          }

          // Handle pong
          if (message.type === 'pong') {
            console.log('Received pong');
          }

          // Handle subscription acknowledgment
          if (message.type === 'ack') {
            console.log('Subscription acknowledged');
            // Fetch initial snapshot
            await fetchOrderBookSnapshot();
          }

          // Handle orderbook updates
          if (message.type === 'message' && message.topic === `/market/level2:${symbol}`) {
            updateOrderBook(message.data);
          }
        };

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };

        wsRef.current.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          if (pingInterval) clearInterval(pingInterval);
        };

      } catch (error) {
        console.error('Error connecting to WebSocket:', error);
      }
    };

    const fetchOrderBookSnapshot = async () => {
      try {
        console.log('Fetching orderbook snapshot...');
        const response = await fetch(
          `/api/api/v1/market/orderbook/level2_20?symbol=${symbol}`
        );
        const data = await response.json();
        console.log('Orderbook snapshot response:', data.code, 'bids:', data.data?.bids?.length, 'asks:', data.data?.asks?.length);

        if (data.code === '200000') {
          // Initialize orderbook with snapshot
          const snapshot = data.data;
          orderBookRef.current = {
            bids: Object.fromEntries(snapshot.bids.map(([price, size]) => [price, size])),
            asks: Object.fromEntries(snapshot.asks.map(([price, size]) => [price, size]))
          };

          // Calculate and store actual last price from raw data (before grouping)
          if (snapshot.bids.length > 0 && snapshot.asks.length > 0) {
            const highestBid = Math.max(...snapshot.bids.map(([price]) => parseFloat(price)));
            const lowestAsk = Math.min(...snapshot.asks.map(([price]) => parseFloat(price)));
            const midPrice = (highestBid + lowestAsk) / 2;
            actualLastPriceRef.current = midPrice;
            setLastPrice(midPrice);
          }

          console.log('Orderbook data loaded. Triggering display update...');
          setOrderbookUpdateTrigger(prev => prev + 1); // Trigger the precision useEffect
        }
      } catch (error) {
        console.error('Error fetching orderbook snapshot:', error);
      }
    };

    const updateOrderBook = (data) => {
      const { changes } = data;

      // Update bids
      if (changes.bids) {
        changes.bids.forEach(([price, size]) => {
          if (parseFloat(size) === 0) {
            delete orderBookRef.current.bids[price];
          } else {
            orderBookRef.current.bids[price] = size;
          }
        });
      }

      // Update asks
      if (changes.asks) {
        changes.asks.forEach(([price, size]) => {
          if (parseFloat(size) === 0) {
            delete orderBookRef.current.asks[price];
          } else {
            orderBookRef.current.asks[price] = size;
          }
        });
      }

      // Don't trigger on every WebSocket update - too frequent!
      // The interval-based update will handle display refresh
    };

    const updateDisplayedOrders = () => {
      // Skip if precision is not yet loaded
      if (!precision) {
        console.log('updateDisplayedOrders: skipping because precision is null');
        return;
      }
      console.log('updateDisplayedOrders: processing with precision:', precision);

      // Helper function to group BIDS - round DOWN to keep prices lower
      const groupBidsByPrecision = (orders) => {
        const grouped = {};
        orders.forEach(([price, size]) => {
          const priceNum = parseFloat(price);
          const sizeNum = parseFloat(size);
          // Floor for bids - round DOWN
          const roundedPrice = Math.floor(priceNum / precision) * precision;

          if (roundedPrice > 0) { // Filter out zero prices only
            if (!grouped[roundedPrice]) {
              grouped[roundedPrice] = 0;
            }
            grouped[roundedPrice] += sizeNum;
          }
        });
        return grouped;
      };

      // Helper function to group ASKS - round UP to keep prices higher
      const groupAsksByPrecision = (orders) => {
        const grouped = {};
        orders.forEach(([price, size]) => {
          const priceNum = parseFloat(price);
          const sizeNum = parseFloat(size);
          // Ceil for asks - round UP
          const roundedPrice = Math.ceil(priceNum / precision) * precision;

          if (roundedPrice > 0) { // Filter out zero prices only
            if (!grouped[roundedPrice]) {
              grouped[roundedPrice] = 0;
            }
            grouped[roundedPrice] += sizeNum;
          }
        });
        return grouped;
      };

      // Group and sort bids (descending)
      const groupedBids = groupBidsByPrecision(Object.entries(orderBookRef.current.bids));
      const sortedBids = Object.entries(groupedBids)
        .map(([price, size]) => ({
          price: parseFloat(price),
          size: size,
          total: 0
        }))
        .filter(bid => bid.price > 0) // Filter out zero prices
        .sort((a, b) => b.price - a.price)
        .slice(0, depth);

      // Calculate cumulative totals for bids
      let bidTotal = 0;
      sortedBids.forEach(bid => {
        bidTotal += bid.size;
        bid.total = bidTotal;
      });

      // Group and sort asks (ascending)
      const groupedAsks = groupAsksByPrecision(Object.entries(orderBookRef.current.asks));
      const sortedAsks = Object.entries(groupedAsks)
        .map(([price, size]) => ({
          price: parseFloat(price),
          size: size,
          total: 0
        }))
        .filter(ask => ask.price > 0) // Filter out zero prices
        .sort((a, b) => a.price - b.price)
        .slice(0, depth);

      // Calculate cumulative totals for asks
      let askTotal = 0;
      sortedAsks.forEach(ask => {
        askTotal += ask.size;
        ask.total = askTotal;
      });

      setBids(sortedBids);
      setAsks(sortedAsks.reverse()); // Reverse to display highest ask at bottom

      // Don't recalculate last price - keep the actual price from raw data
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (pingInterval) {
        clearInterval(pingInterval);
      }
    };
  }, [symbol, depth]);

  // Update displayed orders when precision changes
  useEffect(() => {
    console.log('Precision changed useEffect triggered. Precision:', precision, 'Has orderbook data:', Object.keys(orderBookRef.current.bids).length > 0);

    if (!precision) {
      console.log('Precision useEffect: skipping because precision is null');
      return;
    }

    if (Object.keys(orderBookRef.current.bids).length > 0 ||
        Object.keys(orderBookRef.current.asks).length > 0) {
      console.log('Precision useEffect: updating displayed orders');
      const updateDisplayedOrders = () => {
        // Helper function to group BIDS - round DOWN to keep prices lower
        const groupBidsByPrecision = (orders) => {
          const grouped = {};
          orders.forEach(([price, size]) => {
            const priceNum = parseFloat(price);
            const sizeNum = parseFloat(size);
            // Floor for bids - round DOWN
            const roundedPrice = Math.floor(priceNum / precision) * precision;

            if (roundedPrice > 0) { // Filter out zero prices only
              if (!grouped[roundedPrice]) {
                grouped[roundedPrice] = 0;
              }
              grouped[roundedPrice] += sizeNum;
            }
          });
          return grouped;
        };

        // Helper function to group ASKS - round UP to keep prices higher
        const groupAsksByPrecision = (orders) => {
          const grouped = {};
          orders.forEach(([price, size]) => {
            const priceNum = parseFloat(price);
            const sizeNum = parseFloat(size);
            // Ceil for asks - round UP
            const roundedPrice = Math.ceil(priceNum / precision) * precision;

            if (roundedPrice > 0) { // Filter out zero prices only
              if (!grouped[roundedPrice]) {
                grouped[roundedPrice] = 0;
              }
              grouped[roundedPrice] += sizeNum;
            }
          });
          return grouped;
        };

        // Group and sort bids (descending)
        const groupedBids = groupBidsByPrecision(Object.entries(orderBookRef.current.bids));
        const sortedBids = Object.entries(groupedBids)
          .map(([price, size]) => ({
            price: parseFloat(price),
            size: size,
            total: 0
          }))
          .filter(bid => bid.price > 0) // Filter out zero prices
          .sort((a, b) => b.price - a.price)
          .slice(0, depth);

        // Calculate cumulative totals for bids
        let bidTotal = 0;
        sortedBids.forEach(bid => {
          bidTotal += bid.size;
          bid.total = bidTotal;
        });

        // Group and sort asks (ascending)
        const groupedAsks = groupAsksByPrecision(Object.entries(orderBookRef.current.asks));
        const sortedAsks = Object.entries(groupedAsks)
          .map(([price, size]) => ({
            price: parseFloat(price),
            size: size,
            total: 0
          }))
          .filter(ask => ask.price > 0) // Filter out zero prices
          .sort((a, b) => a.price - b.price)
          .slice(0, depth);

        // Calculate cumulative totals for asks
        let askTotal = 0;
        sortedAsks.forEach(ask => {
          askTotal += ask.size;
          ask.total = askTotal;
        });

        setBids(sortedBids);
        setAsks(sortedAsks.reverse());

        // Don't recalculate last price - keep the actual price from raw data
      };

      updateDisplayedOrders();
    }
  }, [precision, depth, orderbookUpdateTrigger]);

  // Periodic update for real-time WebSocket data
  useEffect(() => {
    if (!precision) return;

    const interval = setInterval(() => {
      // Trigger display update every 500ms to show WebSocket updates
      if (Object.keys(orderBookRef.current.bids).length > 0) {
        setOrderbookUpdateTrigger(prev => prev + 1);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [precision]);

  const maxTotal = Math.max(
    bids[0]?.total || 0,
    asks[0]?.total || 0
  );

  const formatPrice = (price) => {
    if (!precision) return price.toFixed(2);

    // Determine decimal places based on precision
    let decimalPlaces = 2;

    if (precision >= 1) {
      decimalPlaces = 0;
    } else {
      // Count decimal places in precision
      const precisionStr = precision.toString();
      if (precisionStr.includes('.')) {
        decimalPlaces = precisionStr.split('.')[1].length;
      } else if (precisionStr.includes('e')) {
        // Handle scientific notation (e.g., 1e-8)
        const match = precisionStr.match(/e-(\d+)/);
        if (match) {
          decimalPlaces = parseInt(match[1]);
        }
      }
    }

    return price.toLocaleString('en-US', {
      minimumFractionDigits: Math.min(decimalPlaces, 8),
      maximumFractionDigits: Math.min(decimalPlaces, 8)
    });
  };

  const formatSize = (size) => {
    // Smart formatting for amounts - use fewer decimals for large numbers
    if (size >= 1000000) {
      // Millions - no decimals needed
      return size.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    } else if (size >= 1000) {
      // Thousands - 2 decimals
      return size.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } else {
      // Small amounts - 4 decimals
      return size.toLocaleString('en-US', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
      });
    }
  };

  // Format last price - shows appropriate decimals based on price magnitude
  const formatLastPrice = (price) => {
    if (!price) return '---';

    // For very small prices (< 0.01), show up to 8 significant decimals
    if (price < 0.01) {
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
      });
    } else if (price < 1) {
      // For prices between 0.01 and 1, show 4 decimals
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      });
    } else {
      // For prices >= 1, show 2 decimals
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  };

  const handleSymbolChange = () => {
    const upperSymbol = symbolInput.toUpperCase().trim();
    if (upperSymbol && upperSymbol !== symbol) {
      // Reset state when changing symbol
      setBids([]);
      setAsks([]);
      setLastPrice(null);
      setPrecision(null);
      setPrecisionOptions([]);
      orderBookRef.current = { bids: {}, asks: {} };
      setSymbol(upperSymbol);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSymbolChange();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-[#1a1e3e] rounded-lg shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-[#0a0e27] px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Order Book</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">{symbol}</span>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </div>
      </div>

      {/* Symbol Input */}
      <div className="px-4 py-3 bg-[#0f1331] border-b border-gray-700">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 font-semibold whitespace-nowrap">Trading Pair:</label>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="BTC-USDT"
            className="flex-1 px-3 py-1.5 text-sm bg-[#1a1e3e] text-white border border-gray-600 rounded focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleSymbolChange}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors font-medium"
          >
            Load
          </button>
        </div>
      </div>

      {/* Precision Selector */}
      {precisionOptions.length > 0 && (
        <div className="px-4 py-3 bg-[#0f1331] border-b border-gray-700">
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-400 font-semibold whitespace-nowrap">Precision:</label>
            <select
              value={precision}
              onChange={(e) => setPrecision(parseFloat(e.target.value))}
              className="flex-1 px-3 py-1.5 text-sm bg-[#1a1e3e] text-white border border-gray-600 rounded focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              {precisionOptions.map((option) => {
                // Format precision display
                let displayValue;
                if (option >= 1) {
                  displayValue = option.toString();
                } else if (option >= 0.01) {
                  displayValue = option.toFixed(2);
                } else if (option >= 0.001) {
                  displayValue = option.toFixed(3);
                } else {
                  displayValue = option.toFixed(4);
                }

                return (
                  <option key={option} value={option}>
                    {displayValue}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="px-4 py-2 bg-[#0f1331] border-b border-gray-700">
        <div className="grid grid-cols-3 text-xs text-gray-400 font-semibold">
          <div className="text-left">Price (USDT)</div>
          <div className="text-right">Amount (BTC)</div>
          <div className="text-right">Total</div>
        </div>
      </div>

      {/* Order Book Content */}
      <div className="relative">
        {/* Asks (Sell Orders) */}
        <div className="px-4 py-2">
          {asks.map((ask, index) => (
            <div
              key={`ask-${index}`}
              className="relative grid grid-cols-3 text-sm py-1 hover:bg-[#252a4f] transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-red-900/20"
                style={{ width: `${(ask.total / maxTotal) * 100}%` }}
              />
              <div className="relative z-10 text-red-400 font-mono">
                {formatPrice(ask.price)}
              </div>
              <div className="relative z-10 text-right text-gray-300 font-mono">
                {formatSize(ask.size)}
              </div>
              <div className="relative z-10 text-right text-gray-400 font-mono text-xs">
                {formatSize(ask.total)}
              </div>
            </div>
          ))}
        </div>

        {/* Spread / Last Price */}
        <div className="px-4 py-3 bg-[#0f1331] border-y border-gray-700">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400 font-mono">
              {formatLastPrice(lastPrice)}
            </div>
            <div className="text-xs text-gray-400 mt-1">Last Price</div>
          </div>
        </div>

        {/* Bids (Buy Orders) */}
        <div className="px-4 py-2">
          {bids.map((bid, index) => (
            <div
              key={`bid-${index}`}
              className="relative grid grid-cols-3 text-sm py-1 hover:bg-[#252a4f] transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-green-900/20"
                style={{ width: `${(bid.total / maxTotal) * 100}%` }}
              />
              <div className="relative z-10 text-green-400 font-mono">
                {formatPrice(bid.price)}
              </div>
              <div className="relative z-10 text-right text-gray-300 font-mono">
                {formatSize(bid.size)}
              </div>
              <div className="relative z-10 text-right text-gray-400 font-mono text-xs">
                {formatSize(bid.total)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-[#0a0e27] border-t border-gray-700 text-center text-xs text-gray-500">
        Real-time data from KuCoin
      </div>
    </div>
  );
};

export default Orderbook;
