import { iff } from 'feathers-hooks-common';
import { hooks } from 'mostly-feathers-mongoose';
import { cache } from 'mostly-feathers-cache';
import { sanitize, validate } from 'mostly-feathers-validate';
import feeds from 'playing-feed-common';

import accepts from './user-mission-invite.accepts';
import notifiers from './user-mission-invite.notifiers';

export default function (options = {}) {
  return {
    before: {
      all: [
        hooks.authenticate('jwt', options.auth, 'scores,actions'),
        cache(options.cache)
      ],
      find: [
        hooks.addRouteObject('primary', { service: 'user-missions' }),
      ],
      create: [
        hooks.addRouteObject('primary', { service: 'user-missions' }),
        sanitize(accepts),
        validate(accepts)
      ],
      patch: [
        hooks.addRouteObject('primary', { service: 'user-missions' }),
        sanitize(accepts),
        validate(accepts)
      ],
      remove: [
        hooks.addRouteObject('primary', { service: 'user-missions' }),
        sanitize(accepts),
        validate(accepts)
      ]
    },
    after: {
      all: [
        cache(options.cache),
        hooks.responder()
      ],
      patch: [
        feeds.notify('mission.invite.accept', notifiers),
      ],
      remove: [
        iff(hooks.isAction('reject'),
          feeds.notify('mission.invite.reject', notifiers))
      ]
    }
  };
}