import { LockFreeOrderQueue, OrderEncoder, LockFreeQueueBenchmark } from './LockFreeOrderQueue';

async function testBasicOperations() {
  console.log('🧪 Testing Lock-Free Order Queue Basic Operations\n');
  
  const queue = new LockFreeOrderQueue(100);
  
  // Test single enqueue/dequeue
  const order1 = {
    symbol: 'BTC/USD',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 1,
    price: 50000,
    venue: 'binance',
    status: 'PENDING',
    id: 'ORD123',
    clientOrderId: 'CLIENT123'
  };
  
  const encoded1 = OrderEncoder.encode(order1);
  const enqueued = queue.enqueue(encoded1);
  console.log(`✅ Enqueue successful: ${enqueued}`);
  
  const dequeued = queue.dequeue();
  console.log(`✅ Dequeue successful: ${dequeued !== null}`);
  console.log(`   Order ID High: ${dequeued?.orderIdHigh}`);
  
  // Test batch operations
  const orders = [];
  for (let i = 0; i < 50; i++) {
    orders.push(OrderEncoder.encode({
      ...order1,
      id: `ORD${i}`,
      clientOrderId: `CLIENT${i}`
    }));
  }
  
  const batchEnqueued = queue.enqueueBatch(orders);
  console.log(`\n✅ Batch enqueue: ${batchEnqueued} orders`);
  
  const batchDequeued = queue.dequeueBatch(25);
  console.log(`✅ Batch dequeue: ${batchDequeued.length} orders`);
  
  const stats = queue.getStats();
  console.log('\n📊 Queue Stats:');
  console.log(`   Size: ${stats.size}`);
  console.log(`   Capacity: ${stats.capacity}`);
  console.log(`   Sequence: ${stats.sequence}`);
}

async function testConcurrentAccess() {
  console.log('\n\n🧪 Testing Concurrent Access\n');
  
  const queue = new LockFreeOrderQueue(10000);
  const numProducers = 4;
  const numConsumers = 4;
  const ordersPerProducer = 1000;
  
  let totalProduced = 0;
  let totalConsumed = 0;
  
  // Producer function
  const produce = async (id: number) => {
    for (let i = 0; i < ordersPerProducer; i++) {
      const order = OrderEncoder.encode({
        symbol: 'ETH/USD',
        side: i % 2 === 0 ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity: Math.random() * 10,
        price: 3000 + Math.random() * 100,
        venue: 'coinbase',
        status: 'PENDING',
        id: `P${id}O${i}`,
        clientOrderId: `P${id}C${i}`
      });
      
      while (!queue.enqueue(order)) {
        // Queue full, wait
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
      if (i % 100 === 0) {
        console.log(`Producer ${id}: ${i} orders sent`);
      }
    }
    return ordersPerProducer;
  };
  
  // Consumer function
  const consume = async (id: number) => {
    let consumed = 0;
    const targetConsume = (numProducers * ordersPerProducer) / numConsumers;
    
    while (consumed < targetConsume) {
      const order = await queue.dequeueWait(100);
      if (order) {
        consumed++;
        if (consumed % 100 === 0) {
          console.log(`Consumer ${id}: ${consumed} orders processed`);
        }
      }
    }
    return consumed;
  };
  
  // Start producers and consumers
  const startTime = Date.now();
  
  const producerPromises = Array.from({ length: numProducers }, (_, i) => 
    produce(i).then(count => {
      totalProduced += count;
      return count;
    })
  );
  
  const consumerPromises = Array.from({ length: numConsumers }, (_, i) => 
    consume(i).then(count => {
      totalConsumed += count;
      return count;
    })
  );
  
  await Promise.all([...producerPromises, ...consumerPromises]);
  
  const duration = (Date.now() - startTime) / 1000;
  const throughput = (totalProduced + totalConsumed) / 2 / duration;
  
  console.log('\n📊 Concurrent Test Results:');
  console.log(`   Duration: ${duration.toFixed(2)}s`);
  console.log(`   Total Produced: ${totalProduced}`);
  console.log(`   Total Consumed: ${totalConsumed}`);
  console.log(`   Throughput: ${throughput.toFixed(0)} orders/second`);
  
  const finalStats = queue.getStats();
  console.log(`   Final Queue Size: ${finalStats.size}`);
}

async function runAllTests() {
  console.log('🚀 Lock-Free Order Queue Test Suite\n');
  console.log('=' .repeat(50));
  
  await testBasicOperations();
  await testConcurrentAccess();
  
  console.log('\n' + '=' .repeat(50));
  console.log('\n✅ All tests completed!\n');
}

// Run tests
runAllTests().catch(console.error); 