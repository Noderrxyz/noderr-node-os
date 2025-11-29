import { ReinforcementLog, ReinforcementEvent } from '../ReinforcementLog.js';
import { InfluenceGraph } from '../InfluenceGraph.js';

describe('ReinforcementLog', () => {
  let log: ReinforcementLog;

  beforeEach(() => {
    log = new ReinforcementLog();
  });

  test('records a reinforcement event', () => {
    const event = log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'helpful signal accuracy',
      weight: 0.8,
      decayTTL: 1000 * 60 * 60 * 24 * 7, // 1 week
      tags: ['accuracy', 'signal']
    });

    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('timestamp');
    expect(event.sourceAgent).toBe('agent.A');
    expect(event.targetAgent).toBe('agent.B');
    expect(event.reason).toBe('helpful signal accuracy');
    expect(event.weight).toBe(0.8);
    expect(event.tags).toEqual(['accuracy', 'signal']);
  });

  test('gets all events', () => {
    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'helpful signal accuracy',
      weight: 0.8,
      decayTTL: 1000 * 60 * 60 * 24 * 7
    });

    log.record({
      sourceAgent: 'agent.C',
      targetAgent: 'agent.D',
      reason: 'consensus alignment',
      weight: 0.5,
      decayTTL: 1000 * 60 * 60 * 24 * 3
    });

    const events = log.getAll();
    expect(events.length).toBe(2);
    expect(events[0].sourceAgent).toBe('agent.A');
    expect(events[1].sourceAgent).toBe('agent.C');
  });

  test('filters events by agent', () => {
    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'reason1',
      weight: 0.8,
      decayTTL: 1000
    });

    log.record({
      sourceAgent: 'agent.C',
      targetAgent: 'agent.A',
      reason: 'reason2',
      weight: 0.5,
      decayTTL: 1000
    });

    const agentEvents = log.getByAgent('agent.A');
    expect(agentEvents.length).toBe(2);

    const sourceEvents = log.getBySourceAgent('agent.A');
    expect(sourceEvents.length).toBe(1);
    expect(sourceEvents[0].targetAgent).toBe('agent.B');

    const targetEvents = log.getByTargetAgent('agent.A');
    expect(targetEvents.length).toBe(1);
    expect(targetEvents[0].sourceAgent).toBe('agent.C');
  });

  test('filters events by tags', () => {
    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'reason1',
      weight: 0.8,
      decayTTL: 1000,
      tags: ['tag1', 'tag2']
    });

    log.record({
      sourceAgent: 'agent.C',
      targetAgent: 'agent.D',
      reason: 'reason2',
      weight: 0.5,
      decayTTL: 1000,
      tags: ['tag2', 'tag3']
    });

    const taggedEvents = log.getByTags(['tag1']);
    expect(taggedEvents.length).toBe(1);
    expect(taggedEvents[0].sourceAgent).toBe('agent.A');

    const multiTaggedEvents = log.getByTags(['tag2']);
    expect(multiTaggedEvents.length).toBe(2);
  });

  test('prunes expired events', () => {
    // Event already expired
    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'expired',
      weight: 0.8,
      decayTTL: -1000 // Negative TTL to ensure it's expired
    });

    // Event not expired
    log.record({
      sourceAgent: 'agent.C',
      targetAgent: 'agent.D',
      reason: 'active',
      weight: 0.5,
      decayTTL: 1000 * 60 * 60 * 24 // 1 day
    });

    log.pruneExpired();
    
    const events = log.getAll();
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe('active');
  });

  test('converts to influence graph', () => {
    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.B',
      reason: 'reason1',
      weight: 0.8,
      decayTTL: 1000
    });

    log.record({
      sourceAgent: 'agent.A',
      targetAgent: 'agent.C',
      reason: 'reason2',
      weight: 0.5,
      decayTTL: 1000
    });

    const graph = log.toGraph();
    expect(graph).toBeInstanceOf(InfluenceGraph);
    
    const edges = graph.getEdges();
    expect(edges.length).toBe(2);
    expect(edges[0].from).toBe('agent.A');
    expect(edges[0].to).toBe('agent.B');
    expect(edges[0].weight).toBe(0.8);
  });
});

describe('InfluenceGraph', () => {
  let graph: InfluenceGraph;

  beforeEach(() => {
    graph = new InfluenceGraph();
  });

  test('adds edges to the graph', () => {
    graph.addEdge('agent.A', 'agent.B', 0.8, 'reason1');
    graph.addEdge('agent.A', 'agent.C', 0.5, 'reason2');

    const edges = graph.getEdges();
    expect(edges.length).toBe(2);
    expect(edges[0].from).toBe('agent.A');
    expect(edges[0].to).toBe('agent.B');
    expect(edges[0].weight).toBe(0.8);
    expect(edges[0].reason).toBe('reason1');
  });

  test('gets nodes in the graph', () => {
    graph.addEdge('agent.A', 'agent.B', 0.8, 'reason1');
    graph.addEdge('agent.A', 'agent.C', 0.5, 'reason2');
    graph.addEdge('agent.D', 'agent.C', 0.3, 'reason3');

    const nodes = graph.getNodes();
    expect(nodes.length).toBe(4);
    expect(nodes).toContain('agent.A');
    expect(nodes).toContain('agent.B');
    expect(nodes).toContain('agent.C');
    expect(nodes).toContain('agent.D');
  });

  test('gets influencers for an agent', () => {
    graph.addEdge('agent.A', 'agent.C', 0.5, 'reason1');
    graph.addEdge('agent.B', 'agent.C', 0.3, 'reason2');
    graph.addEdge('agent.C', 'agent.D', 0.7, 'reason3');

    const influencers = graph.getInfluencers('agent.C');
    expect(influencers.length).toBe(2);
    expect(influencers[0].from).toBe('agent.A');
    expect(influencers[1].from).toBe('agent.B');
  });

  test('gets targets for an agent', () => {
    graph.addEdge('agent.A', 'agent.B', 0.5, 'reason1');
    graph.addEdge('agent.A', 'agent.C', 0.3, 'reason2');
    graph.addEdge('agent.B', 'agent.D', 0.7, 'reason3');

    const targets = graph.getTargets('agent.A');
    expect(targets.length).toBe(2);
    expect(targets[0].to).toBe('agent.B');
    expect(targets[1].to).toBe('agent.C');
  });

  test('calculates total influence weights', () => {
    graph.addEdge('agent.A', 'agent.C', 0.5, 'reason1');
    graph.addEdge('agent.B', 'agent.C', 0.3, 'reason2');
    graph.addEdge('agent.C', 'agent.D', 0.7, 'reason3');
    graph.addEdge('agent.C', 'agent.E', 0.2, 'reason4');

    const incomingTotal = graph.getIncomingInfluenceTotal('agent.C');
    expect(incomingTotal).toBe(0.8); // 0.5 + 0.3

    const outgoingTotal = graph.getOutgoingInfluenceTotal('agent.C');
    expect(outgoingTotal).toBe(0.9); // 0.7 + 0.2
  });

  test('creates adjacency map', () => {
    graph.addEdge('agent.A', 'agent.B', 0.5, 'reason1');
    graph.addEdge('agent.A', 'agent.C', 0.3, 'reason2');
    graph.addEdge('agent.B', 'agent.D', 0.7, 'reason3');

    const adjMap = graph.asAdjacencyMap();
    expect(Object.keys(adjMap).length).toBe(2);
    expect(adjMap['agent.A'].length).toBe(2);
    expect(adjMap['agent.B'].length).toBe(1);
    expect(adjMap['agent.A'][0].to).toBe('agent.B');
    expect(adjMap['agent.A'][1].to).toBe('agent.C');
    expect(adjMap['agent.B'][0].to).toBe('agent.D');
  });

  test('detects circular influence', () => {
    // No circular influence
    graph.addEdge('agent.A', 'agent.B', 0.5, 'reason1');
    graph.addEdge('agent.B', 'agent.C', 0.3, 'reason2');
    expect(graph.hasCircularInfluence()).toBe(false);

    // Create circular influence
    graph.addEdge('agent.C', 'agent.A', 0.2, 'reason3');
    expect(graph.hasCircularInfluence()).toBe(true);
  });
}); 