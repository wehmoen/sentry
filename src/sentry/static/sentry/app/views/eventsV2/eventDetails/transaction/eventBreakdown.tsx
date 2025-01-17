import React from 'react';
import styled from 'react-emotion';
import get from 'lodash/get';

import {Event} from 'app/types';
import {
  SentryTransactionEvent,
  SpanEntry,
  SpanType,
} from 'app/components/events/interfaces/spans/types';
import {pickSpanBarColour} from 'app/components/events/interfaces/spans/utils';
import {TraceContextType} from 'app/components/events/interfaces/spans/traceView';
import {t} from 'app/locale';
import space from 'app/styles/space';
import {SectionHeading} from '../../styles';

type OpStats = {percentage: number; totalDuration: number};

const TOP_N_SPANS = 4;

type EventBreakdownType = {
  // top TOP_N_SPANS spans
  ops: ({name: string} & OpStats)[];
  // the rest of the spans
  other: OpStats | undefined;
};

type Props = {
  event: Event;
};

class EventBreakdown extends React.Component<Props> {
  getTransactionEvent(): SentryTransactionEvent | undefined {
    const {event} = this.props;

    if (event.type === 'transaction') {
      return event as SentryTransactionEvent;
    }

    return undefined;
  }

  generateStats(): EventBreakdownType {
    const event = this.getTransactionEvent();

    if (!event) {
      return {
        ops: [],
        other: undefined,
      };
    }

    const traceContext: TraceContextType | undefined = get(event, 'contexts.trace');

    if (!traceContext) {
      return {
        ops: [],
        other: undefined,
      };
    }

    const spanEntry: SpanEntry | undefined = event.entries.find(
      (entry: {type: string}) => entry.type === 'spans'
    );

    const spans: SpanType[] = get(spanEntry, 'data', []);

    type AggregateType = {
      [opname: string]: {
        totalDuration: number; // num of seconds
      };
    };

    let cumulativeDuration = 0;

    // add the transaction itself as a span
    spans.push({
      op: traceContext.op,
      timestamp: event.endTimestamp,
      start_timestamp: event.startTimestamp,
      trace_id: traceContext.trace_id || '',
      span_id: traceContext.span_id || '',
      data: {},
    });

    const aggregateByOp: AggregateType = spans.reduce(
      (aggregate: AggregateType, span: SpanType) => {
        let op = span.op;

        const duration = Math.abs(span.timestamp - span.start_timestamp);
        cumulativeDuration += duration;

        if (typeof op !== 'string') {
          // a span with no operation name is considered an 'unknown' op
          op = 'unknown';
        }
        const opStats = aggregate[op];

        if (!opStats) {
          aggregate[op] = {
            totalDuration: duration,
          };
          return aggregate;
        }

        aggregate[op].totalDuration += duration;

        return aggregate;
      },
      {}
    );

    const ops = Object.keys(aggregateByOp).map(opName => {
      return {
        name: opName,
        percentage: aggregateByOp[opName].totalDuration / cumulativeDuration,
        totalDuration: aggregateByOp[opName].totalDuration,
      };
    });

    ops.sort((firstOp, secondOp) => {
      // sort in descending order based on total duration

      if (firstOp.percentage === secondOp.percentage) {
        return 0;
      }

      if (firstOp.percentage > secondOp.percentage) {
        return -1;
      }

      return 1;
    });

    const other = ops
      .slice(TOP_N_SPANS)
      .reduce((accOther: OpStats | undefined, currentOp) => {
        if (!accOther) {
          return {
            percentage: currentOp.totalDuration / cumulativeDuration,
            totalDuration: currentOp.totalDuration,
          };
        }

        accOther.totalDuration += currentOp.totalDuration;
        accOther.percentage = accOther.totalDuration / cumulativeDuration;

        return accOther;
      }, undefined);

    return {
      // use the first TOP_N_SPANS ops with the top total duration
      ops: ops.slice(0, TOP_N_SPANS),
      other,
    };
  }

  render() {
    const event = this.getTransactionEvent();

    if (!event) {
      return null;
    }

    const results = this.generateStats();

    return (
      <StyledBreakdown>
        <SectionHeading>{t('Ops Breakdown')}</SectionHeading>
        {results.ops.map(currOp => {
          const {name, percentage, totalDuration} = currOp;
          const durLabel = Math.round(totalDuration * 1000 * 100) / 100;
          const pctLabel = Math.round(percentage * 100);
          const opsColor: string = pickSpanBarColour(name);

          return (
            <OpsLine key={name}>
              <OpsContent>
                <OpsDot style={{backgroundColor: opsColor}} />
                <div>{name}</div>
              </OpsContent>
              <OpsContent>
                <Dur>{durLabel}ms</Dur>
                <Pct>{pctLabel}%</Pct>
              </OpsContent>
            </OpsLine>
          );
        })}
      </StyledBreakdown>
    );
  }
}

const StyledBreakdown = styled('div')`
  color: ${p => p.theme.gray3};
  font-size: ${p => p.theme.fontSizeMedium};
  margin-bottom: ${space(4)};
`;

const OpsLine = styled('div')`
  display: flex;
  justify-content: space-between;
  margin-bottom: ${space(0.5)};
`;

const OpsDot = styled('div')`
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  margin-right: ${space(1)};
  border-radius: 100%;
`;

const OpsContent = styled('div')`
  display: flex;
  align-items: center;
`;

const Dur = styled('div')`
  color: ${p => p.theme.gray2};
`;

const Pct = styled('div')`
  min-width: 40px;
  text-align: right;
`;

export default EventBreakdown;
