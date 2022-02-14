import {
  getPathFromEvents,
  SerializedEvent,
  SerializedState,
  SimpleBehavior,
  StatePath,
  StatePlan,
  Step,
  TraversalOptions
} from '@xstate/graph';
import {
  traverseShortestPaths,
  traverseSimplePaths,
  traverseSimplePathsTo
} from '@xstate/graph/src/graph';
import { EventObject } from 'xstate';
import type {
  TestModelCoverage,
  TestModelOptions,
  StatePredicate,
  CoverageOptions,
  TestEventsConfig,
  TestPathResult,
  TestStepResult
} from './types';
import { formatPathTestResult, simpleStringify } from './utils';
import { getEventSamples } from './index';

/**
 * Creates a test model that represents an abstract model of a
 * system under test (SUT).
 *
 * The test model is used to generate test plans, which are used to
 * verify that states in the `machine` are reachable in the SUT.
 *
 * @example
 *
 * ```js
 * const toggleModel = createModel(toggleMachine).withEvents({
 *   TOGGLE: {
 *     exec: async page => {
 *       await page.click('input');
 *     }
 *   }
 * });
 * ```
 *
 */

export class TestModel<TState, TEvent extends EventObject, TTestContext> {
  public coverage: TestModelCoverage = {
    states: {},
    transitions: {}
  };
  public options: TestModelOptions<TState, TEvent, TTestContext>;
  public defaultTraversalOptions?: TraversalOptions<TState, TEvent>;
  public getDefaultOptions(): TestModelOptions<TState, TEvent, TTestContext> {
    return {
      serializeState: (state) => simpleStringify(state) as SerializedState,
      serializeEvent: (event) => simpleStringify(event) as SerializedEvent,
      getEvents: () => [],
      testState: () => void 0,
      testTransition: () => void 0
    };
  }

  constructor(
    public behavior: SimpleBehavior<TState, TEvent>,
    public testContext: TTestContext,
    options?: Partial<TestModelOptions<TState, TEvent, TTestContext>>
  ) {
    this.options = {
      ...this.getDefaultOptions(),
      ...options
    };
  }

  public getShortestPlans(
    options?: Partial<TraversalOptions<TState, TEvent>>
  ): Array<StatePlan<TState, TEvent>> {
    const shortestPaths = traverseShortestPaths(
      this.behavior,
      this.resolveOptions(options)
    );

    return Object.values(shortestPaths);
  }

  public getShortestPlansTo(
    stateValue: StatePredicate<TState>
  ): Array<StatePlan<TState, TEvent>> {
    let minWeight = Infinity;
    let shortestPlans: Array<StatePlan<TState, TEvent>> = [];

    const plans = this.filterPathsTo(stateValue, this.getShortestPlans());

    for (const plan of plans) {
      const currWeight = plan.paths[0].weight;
      if (currWeight < minWeight) {
        minWeight = currWeight;
        shortestPlans = [plan];
      } else if (currWeight === minWeight) {
        shortestPlans.push(plan);
      }
    }

    return shortestPlans;
  }

  public getSimplePlans(
    options?: Partial<TraversalOptions<TState, any>>
  ): Array<StatePlan<TState, TEvent>> {
    const simplePaths = traverseSimplePaths(
      this.behavior,
      this.resolveOptions(options)
    );

    return Object.values(simplePaths);
  }

  public getSimplePlansTo(
    predicate: StatePredicate<TState>
  ): Array<StatePlan<TState, TEvent>> {
    return traverseSimplePathsTo(this.behavior, predicate, this.options);
  }

  private filterPathsTo(
    statePredicate: StatePredicate<TState>,
    testPlans: Array<StatePlan<TState, TEvent>>
  ): Array<StatePlan<TState, TEvent>> {
    const predicate: StatePredicate<TState> = (state) => statePredicate(state);

    return testPlans.filter((testPlan) => {
      return predicate(testPlan.state);
    });
  }

  public getPlanFromEvents(
    events: TEvent[],
    statePredicate: StatePredicate<TState>
  ): StatePlan<TState, TEvent> {
    const path = getPathFromEvents(this.behavior, events);

    if (!statePredicate(path.state)) {
      throw new Error(
        `The last state ${JSON.stringify(
          (path.state as any).value
        )} does not match the target}`
      );
    }

    const plan: StatePlan<TState, TEvent> = {
      state: path.state,
      paths: [path]
    };

    return plan;
  }

  public async testPlan(
    plan: StatePlan<TState, TEvent>,
    testContext: TTestContext
  ) {
    for (const path of plan.paths) {
      await this.testPath(path, testContext);
    }
  }

  public async testPath(
    path: StatePath<TState, TEvent>,
    testContext: TTestContext
  ) {
    const testPathResult: TestPathResult = {
      steps: [],
      state: {
        error: null
      }
    };

    try {
      for (const step of path.steps) {
        const testStepResult: TestStepResult = {
          step,
          state: { error: null },
          event: { error: null }
        };

        testPathResult.steps.push(testStepResult);

        try {
          await this.testState(step.state, testContext);
        } catch (err) {
          testStepResult.state.error = err;

          throw err;
        }

        try {
          await this.testTransition(step, testContext);
        } catch (err) {
          testStepResult.event.error = err;

          throw err;
        }
      }

      try {
        await this.testState(path.state, testContext);
      } catch (err) {
        testPathResult.state.error = err.message;
        throw err;
      }
    } catch (err) {
      // TODO: make option
      err.message += formatPathTestResult(path, testPathResult, this.options);
      throw err;
    }
  }

  public async testState(
    state: TState,
    testContext: TTestContext
  ): Promise<void> {
    await this.options.testState(state, testContext);

    this.addStateCoverage(state);
  }

  private addStateCoverage(_state: TState) {
    // TODO
  }

  public async testTransition(
    step: Step<TState, TEvent>,
    testContext: TTestContext
  ): Promise<void> {
    await this.options.testTransition(step, testContext);

    this.addTransitionCoverage(step);
  }

  private addTransitionCoverage(_step: Step<TState, TEvent>) {
    // TODO
  }

  public getCoverage(options?: CoverageOptions<TState>) {
    return options;
    // const filter = options ? options.filter : undefined;
    // const stateNodes = getStateNodes(this.behavior);
    // const filteredStateNodes = filter ? stateNodes.filter(filter) : stateNodes;
    // const coverage = {
    //   stateNodes: filteredStateNodes.reduce((acc, stateNode) => {
    //     acc[stateNode.id] = 0;
    //     return acc;
    //   }, {})
    // };
    // for (const key of this.coverage.stateNodes.keys()) {
    //   coverage.stateNodes[key] = this.coverage.stateNodes.get(key);
    // }
    // return coverage;
  }

  public testCoverage(options?: CoverageOptions<TState>): void {
    return void options;
    // const coverage = this.getCoverage(options);
    // const missingStateNodes = Object.keys(coverage.stateNodes).filter((id) => {
    //   return !coverage.stateNodes[id];
    // });
    // if (missingStateNodes.length) {
    //   throw new Error(
    //     'Missing coverage for state nodes:\n' +
    //       missingStateNodes.map((id) => `\t${id}`).join('\n')
    //   );
    // }
  }

  public withEvents(
    eventMap: TestEventsConfig<TTestContext>
  ): TestModel<TState, TEvent, TTestContext> {
    return new TestModel(this.behavior, this.testContext, {
      ...this.options,
      getEvents: () => getEventSamples(eventMap),
      testTransition: async ({ event }, testContext) => {
        const eventConfig = eventMap[event.type];

        if (!eventConfig) {
          return;
        }

        const exec =
          typeof eventConfig === 'function' ? eventConfig : eventConfig.exec;

        await exec?.(testContext, event);
      }
    });
  }

  public resolveOptions(
    options?: Partial<TestModelOptions<TState, TEvent, TTestContext>>
  ): TestModelOptions<TState, TEvent, TTestContext> {
    return { ...this.defaultTraversalOptions, ...this.options, ...options };
  }
}
