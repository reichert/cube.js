/* eslint-disable */
import ClickHouse from '@apla/clickhouse';
import { GenericContainer } from 'testcontainers';
import { format as formatSql } from 'sqlstring';
import uuidv4 from 'uuid/v4';

process.env.TZ = 'GMT';

export class ClickHouseDbRunner {
  adapter = 'clickhouse';
  container = null;

  tearDown = async () => {
    if (this.container) {
      await this.container.stop();
      this.container = null;
    }
  }

  gutterDataSet = async function (clickHouse) {
    // let engine = 'MergeTree PARTITION BY id ORDER BY (id) SETTINGS index_granularity = 8192'
    const engine = 'Memory';

    await clickHouse.querying(`
    CREATE TEMPORARY TABLE visitors (id UInt64, amount UInt64, created_at DateTime, updated_at DateTime, status UInt64, source Nullable(String), latitude Float64, longitude Float64)
    ENGINE = ${engine}
  `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } }),
      await clickHouse.querying(`
    CREATE TEMPORARY TABLE visitor_checkins (id UInt64, visitor_id UInt64, created_at DateTime, source Nullable(String))
    ENGINE = ${engine}
  `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } }),
      await clickHouse.querying(`
    CREATE TEMPORARY TABLE cards (id UInt64, visitor_id UInt64, visitor_checkin_id UInt64)
    ENGINE = ${engine}
  `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } }),

      await clickHouse.querying(`
      INSERT INTO
      visitors
      (id, amount, created_at, updated_at, status, source, latitude, longitude) VALUES
      (1, 100, '2017-01-02 16:00:00', '2017-01-29 16:00:00', 1, 'some', 120.120, 40.60),
      (2, 200, '2017-01-04 16:00:00', '2017-01-14 16:00:00', 1, 'some', 120.120, 58.60),
      (3, 300, '2017-01-05 16:00:00', '2017-01-19 16:00:00', 2, 'google', 120.120, 70.60),
      (4, 400, '2017-01-06 16:00:00', '2017-01-24 16:00:00', 2, null, 120.120, 10.60),
      (5, 500, '2017-01-06 16:00:00', '2017-01-24 16:00:00', 2, null, 120.120, 58.10),
      (6, 500, '2016-09-06 16:00:00', '2016-09-06 16:00:00', 2, null, 120.120, 58.10)
    `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } }),
      await clickHouse.querying(`
    INSERT INTO
    visitor_checkins
    (id, visitor_id, created_at, source) VALUES
    (1, 1, '2017-01-02 16:00:00', null),
    (2, 1, '2017-01-03 16:00:00', null),
    (3, 1, '2017-01-04 16:00:00', 'google'),
    (4, 2, '2017-01-04 16:00:00', null),
    (5, 2, '2017-01-04 16:00:00', null),
    (6, 3, '2017-01-05 16:00:00', null)
  `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } }),
      await clickHouse.querying(`
    INSERT INTO
    cards
    (id, visitor_id, visitor_checkin_id) VALUES
    (1, 1, 1),
    (2, 1, 2),
    (3, 3, 6)
  `, { queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' } });
  };

  testQueries = async (queries, prepareDataSet) => {
    if (!this.container && !process.env.TEST_CLICKHOUSE_HOST) {
      const version = process.env.TEST_CLICKHOUSE_VERSION || '21.1.2';

      this.container = await new GenericContainer(`yandex/clickhouse-server:${version}`)
        .withExposedPorts(8123)
        .start();
    }

    const clickHouse = new ClickHouse({
      host: 'localhost',
      port: process.env.TEST_CLICKHOUSE_HOST ? 8123 : this.container.getMappedPort(8123),
    });

    clickHouse.sessionId = uuidv4(); // needed for tests to use temporary tables

    prepareDataSet = prepareDataSet || this.gutterDataSet;
    await prepareDataSet(clickHouse);

    const requests = [];

    for (const [query, params] of queries) {
      requests.push(clickHouse.querying(formatSql(query, params), {
        dataObjects: true,
        queryOptions: { session_id: clickHouse.sessionId, join_use_nulls: '1' }
      }));
    }

    const results = await Promise.all(requests);

    return results.map(_normaliseResponse);
  };

  testQuery = async (queryAndParams, prepareDataSet) => this.testQueries([queryAndParams], prepareDataSet)
    .then(res => res[0]);
}

//
//
//  ClickHouse returns DateTime as strings in format "YYYY-DD-MM HH:MM:SS"
//  cube.js expects them in format "YYYY-DD-MMTHH:MM:SS.000", so translate them based on the metadata returned
//
//  https://github.com/statsbotco/cube.js/pull/98#discussion_r279698399
//
function _normaliseResponse(res) {
  if (process.env.DEBUG_LOG === 'true') console.log(res);
  if (res.data) {
    res.data.forEach(row => {
      for (const field in row) {
        const value = row[field];
        if (value !== null) {
          const meta = res.meta.find(m => m.name == field);
          if (meta.type.includes('DateTime')) {
            row[field] = `${value.substring(0, 10)}T${value.substring(11, 22)}.000`;
          } else if (meta.type.includes('Date')) {
            row[field] = `${value}T00:00:00.000`;
          } else if (meta.type.includes('Int') || meta.type.includes('Float')) {
            // convert all numbers into strings
            row[field] = `${value}`;
          }
        }
      }
    });
  }
  return res.data;
}
