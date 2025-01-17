import React from 'react';
import styled from 'react-emotion';
import get from 'lodash/get';
import map from 'lodash/map';

import {t} from 'app/locale';
import {getParams} from 'app/components/organizations/globalSelectionHeader/getParams';
import DateTime from 'app/components/dateTime';
import Pills from 'app/components/pills';
import Pill from 'app/components/pill';
import space from 'app/styles/space';
import withApi from 'app/utils/withApi';
import {Client} from 'app/api';
import Button from 'app/components/button';
import {
  generateEventSlug,
  generateEventDetailsRoute,
} from 'app/views/eventsV2/eventDetails/utils';
import EventView from 'app/views/eventsV2/eventView';
import {generateDiscoverResultsRoute} from 'app/views/eventsV2/results';

import {SpanType, ParsedTraceType} from './types';
import {getTraceDateTimeRange} from './utils';

type TransactionResult = {
  'project.name': string;
  transaction: string;
  id: string;
};

type Props = {
  api: Client;
  orgId: string;
  span: Readonly<SpanType>;
  isRoot: boolean;
  eventView: EventView;
  trace: Readonly<ParsedTraceType>;
};

type State = {
  transactionResults?: TransactionResult[];
};

class SpanDetail extends React.Component<Props, State> {
  state: State = {
    transactionResults: undefined,
  };

  componentDidMount() {
    const {span} = this.props;

    this.fetchSpanDescendents(span.span_id)
      .then(response => {
        if (
          !response.data ||
          !Array.isArray(response.data) ||
          response.data.length <= 0
        ) {
          return;
        }

        this.setState({
          transactionResults: response.data,
        });
      })
      .catch(_error => {
        // don't do anything
      });
  }

  fetchSpanDescendents(spanID: string): Promise<any> {
    const {api, orgId, span, trace} = this.props;

    const url = `/organizations/${orgId}/eventsv2/`;

    const {start, end} = getParams(
      getTraceDateTimeRange({
        start: trace.traceStartTimestamp,
        end: trace.traceEndTimestamp,
      })
    );

    const query = {
      field: ['transaction', 'id', 'trace.span'],
      sort: ['-id'],
      query: `event.type:transaction trace:${span.trace_id} trace.parent_span:${spanID}`,
      start,
      end,
    };

    return api.requestPromise(url, {
      method: 'GET',
      query,
    });
  }

  renderTraversalButton(): React.ReactNode {
    if (!this.state.transactionResults || this.state.transactionResults.length <= 0) {
      return null;
    }

    if (this.state.transactionResults.length === 1) {
      const {eventView} = this.props;

      const parentTransactionLink = generateEventDetailsRoute({
        eventSlug: generateSlug(this.state.transactionResults[0]),
        orgSlug: this.props.orgId,
      });

      const to = {
        pathname: parentTransactionLink,
        query: eventView.generateQueryStringObject(),
      };

      return (
        <StyledButton size="xsmall" to={to}>
          {t('View Child')}
        </StyledButton>
      );
    }

    const {span, orgId, trace} = this.props;

    const {start, end} = getTraceDateTimeRange({
      start: trace.traceStartTimestamp,
      end: trace.traceEndTimestamp,
    });

    const eventView = EventView.fromSavedQuery({
      id: undefined,
      name: t('Transactions'),
      fields: [
        'transaction',
        'project',
        'trace.span',
        'transaction.duration',
        'timestamp',
      ],
      fieldnames: ['transaction', 'project', 'trace.span', 'duration', 'timestamp'],
      orderby: '-timestamp',
      query: `event.type:transaction trace:${span.trace_id} trace.parent_span:${
        span.span_id
      }`,
      tags: ['release', 'project.name', 'user.email', 'user.ip', 'environment'],
      projects: [],
      version: 2,
      start,
      end,
    });

    const to = {
      pathname: generateDiscoverResultsRoute(orgId),
      query: eventView.generateQueryStringObject(),
    };

    return (
      <StyledButton size="xsmall" to={to}>
        {t('View Children')}
      </StyledButton>
    );
  }

  renderTraceButton() {
    const {span, orgId, trace} = this.props;

    const {start, end} = getTraceDateTimeRange({
      start: trace.traceStartTimestamp,
      end: trace.traceEndTimestamp,
    });

    const eventView = EventView.fromSavedQuery({
      id: undefined,
      name: t('Transactions'),
      fields: [
        'transaction',
        'project',
        'trace.span',
        'transaction.duration',
        'timestamp',
      ],
      fieldnames: ['transaction', 'project', 'trace.span', 'duration', 'timestamp'],
      orderby: '-timestamp',
      query: `event.type:transaction trace:${span.trace_id}`,
      tags: ['release', 'project.name', 'user.email', 'user.ip', 'environment'],
      projects: [],
      version: 2,
      start,
      end,
    });

    const to = {
      pathname: generateDiscoverResultsRoute(orgId),
      query: eventView.generateQueryStringObject(),
    };

    return (
      <StyledButton size="xsmall" to={to}>
        {t('Search by Trace')}
      </StyledButton>
    );
  }

  render() {
    const {span} = this.props;

    const startTimestamp: number = span.start_timestamp;
    const endTimestamp: number = span.timestamp;

    const duration = (endTimestamp - startTimestamp) * 1000;
    const durationString = `${duration.toFixed(3)} ms`;

    return (
      <SpanDetailContainer
        data-component="span-detail"
        onClick={event => {
          // prevent toggling the span detail
          event.stopPropagation();
        }}
      >
        <table className="table key-value">
          <tbody>
            <Row title="Span ID" extra={this.renderTraversalButton()}>
              {span.span_id}
            </Row>
            <Row title="Trace ID" extra={this.renderTraceButton()}>
              {span.trace_id}
            </Row>
            <Row title="Parent Span ID">{span.parent_span_id || ''}</Row>
            <Row title="Description">{get(span, 'description', '')}</Row>
            <Row title="Start Date">
              <React.Fragment>
                <DateTime date={startTimestamp * 1000} />
                {` (${startTimestamp})`}
              </React.Fragment>
            </Row>
            <Row title="End Date">
              <React.Fragment>
                <DateTime date={endTimestamp * 1000} />
                {` (${endTimestamp})`}
              </React.Fragment>
            </Row>
            <Row title="Duration">{durationString}</Row>
            <Row title="Operation">{span.op || ''}</Row>
            <Row title="Same Process as Parent">
              {String(!!span.same_process_as_parent)}
            </Row>
            <Tags span={span} />
            {map(get(span, 'data', {}), (value, key) => {
              return (
                <Row title={key} key={key}>
                  {JSON.stringify(value, null, 4) || ''}
                </Row>
              );
            })}
            <Row title="Raw">{JSON.stringify(span, null, 4)}</Row>
          </tbody>
        </table>
      </SpanDetailContainer>
    );
  }
}

const StyledButton = styled(Button)`
  position: absolute;
  top: ${space(0.75)};
  right: ${space(0.5)};
`;

const SpanDetailContainer = styled('div')`
  border-bottom: 1px solid ${p => p.theme.gray1};
  padding: ${space(2)};
  cursor: auto;
`;

const ValueTd = styled('td')`
  position: relative;
`;

const Row = ({
  title,
  keep,
  children,
  extra = null,
}: {
  title: string;
  keep?: boolean;
  children: JSX.Element | string;
  extra?: React.ReactNode;
}) => {
  if (!keep && !children) {
    return null;
  }

  return (
    <tr>
      <td className="key">{title}</td>
      <ValueTd className="value">
        <pre className="val">
          <span className="val-string">{children}</span>
        </pre>
        {extra}
      </ValueTd>
    </tr>
  );
};

const Tags = ({span}: {span: SpanType}) => {
  const tags: {[tag_name: string]: string} | undefined = get(span, 'tags');

  if (!tags) {
    return null;
  }

  const keys = Object.keys(tags);

  if (keys.length <= 0) {
    return null;
  }

  return (
    <tr>
      <td className="key">Tags</td>
      <td className="value">
        <Pills style={{padding: '8px'}}>
          {keys.map((key, index) => {
            return <Pill key={index} name={key} value={String(tags[key]) || ''} />;
          })}
        </Pills>
      </td>
    </tr>
  );
};

function generateSlug(result: TransactionResult): string {
  return generateEventSlug({
    id: result.id,
    'project.name': result['project.name'],
  });
}

export default withApi(SpanDetail);
