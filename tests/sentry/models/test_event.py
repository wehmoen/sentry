from __future__ import absolute_import

import pytest
import pickle

from sentry.models import Environment
from sentry.db.models.fields.node import NodeData
from sentry.testutils import TestCase
from sentry.testutils.factories import Factories


class EventTest(TestCase):
    def test_pickling_compat(self):
        event = self.create_event(
            data={"tags": [("logger", "foobar"), ("site", "foo"), ("server_name", "bar")]}
        )

        # Ensure we load and memoize the interfaces as well.
        assert len(event.interfaces) > 0

        # When we pickle an event we need to make sure our canonical code
        # does not appear here or it breaks old workers.
        data = pickle.dumps(event, protocol=2)
        assert "canonical" not in data

        # For testing we remove the backwards compat support in the
        # `NodeData` as well.
        nodedata_getstate = NodeData.__getstate__
        del NodeData.__getstate__

        # Old worker loading
        try:
            event2 = pickle.loads(data)
            assert event2.data == event.data
        finally:
            NodeData.__getstate__ = nodedata_getstate

        # New worker loading
        event2 = pickle.loads(data)
        assert event2.data == event.data

    def test_event_as_dict(self):
        event = self.create_event(data={"logentry": {"formatted": "Hello World!"}})

        d = event.as_dict()
        assert d["logentry"] == {"formatted": "Hello World!"}

    def test_email_subject(self):
        event1 = self.create_event(
            event_id="a" * 32, group=self.group, tags={"level": "info"}, message="Foo bar"
        )
        event2 = self.create_event(
            event_id="b" * 32, group=self.group, tags={"level": "ERROR"}, message="Foo bar"
        )
        self.group.level = 30

        assert event1.get_email_subject() == "BAR-1 - Foo bar"
        assert event2.get_email_subject() == "BAR-1 - Foo bar"

    def test_email_subject_with_template(self):
        self.project.update_option(
            "mail:subject_template",
            "$shortID - ${tag:environment}@${tag:release} $$ $title ${tag:invalid} $invalid",
        )

        event1 = self.store_event(
            data={
                "event_id": "a" * 32,
                "environment": "production",
                "level": "info",
                "release": "0",
                "message": "baz",
            },
            project_id=self.project.id,
        )

        assert event1.get_email_subject() == "BAR-1 - production@0 $ baz ${tag:invalid} $invalid"

    def test_as_dict_hides_client_ip(self):
        event = self.create_event(
            data={"sdk": {"name": "foo", "version": "1.0", "client_ip": "127.0.0.1"}}
        )
        result = event.as_dict()
        assert result["sdk"] == {"name": "foo", "version": "1.0"}

    def test_get_environment(self):
        environment = Environment.get_or_create(self.project, "production")
        event = self.store_event(data={"environment": "production"}, project_id=self.project.id)

        assert event.get_environment() == environment

        with self.assertNumQueries(0):
            event.get_environment() == environment

    def test_ip_address(self):
        event = self.create_event(
            data={
                "user": {"ip_address": "127.0.0.1"},
                "request": {"url": "http://some.com", "env": {"REMOTE_ADDR": "::1"}},
            }
        )
        assert event.ip_address == "127.0.0.1"

        event = self.create_event(
            data={
                "user": {"ip_address": None},
                "request": {"url": "http://some.com", "env": {"REMOTE_ADDR": "::1"}},
            }
        )
        assert event.ip_address == "::1"

        event = self.create_event(
            data={
                "user": None,
                "request": {"url": "http://some.com", "env": {"REMOTE_ADDR": "::1"}},
            }
        )
        assert event.ip_address == "::1"

        event = self.create_event(
            data={"request": {"url": "http://some.com", "env": {"REMOTE_ADDR": "::1"}}}
        )
        assert event.ip_address == "::1"

        event = self.create_event(
            data={"request": {"url": "http://some.com", "env": {"REMOTE_ADDR": None}}}
        )
        assert event.ip_address is None

        event = self.create_event()
        assert event.ip_address is None

    def test_issueless_event(self):
        event = Factories.create_event(
            group=None,
            project=self.project,
            event_id="a" * 32,
            tags={"level": "info"},
            message="Foo bar",
            data={"culprit": "app/components/events/eventEntries in map"},
        )
        assert event.group is None
        assert event.culprit == "app/components/events/eventEntries in map"


@pytest.mark.django_db
def test_renormalization(monkeypatch, factories, task_runner, default_project):
    from semaphore.processing import StoreNormalizer

    old_normalize = StoreNormalizer.normalize_event
    normalize_mock_calls = []

    def normalize(*args, **kwargs):
        normalize_mock_calls.append(1)
        return old_normalize(*args, **kwargs)

    monkeypatch.setattr("semaphore.processing.StoreNormalizer.normalize_event", normalize)

    with task_runner():
        factories.store_event(
            data={"event_id": "a" * 32, "environment": "production"}, project_id=default_project.id
        )

    # Assert we only renormalize this once. If this assertion fails it's likely
    # that you will encounter severe performance issues during event processing
    # or postprocessing.
    assert len(normalize_mock_calls) == 1
