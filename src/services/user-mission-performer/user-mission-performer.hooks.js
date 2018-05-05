import { hooks } from 'mostly-feathers-mongoose';
import { cache } from 'mostly-feathers-cache';
import { sanitize, validate } from 'mostly-feathers-validate';
import { hooks as feeds } from 'playing-feed-services';

import accepts from './user-mission-performer.accepts';
import notifiers from './user-mission-performer.notifiers';

export default function (options = {}) {
  return {
    before: {
      all: [
        hooks.authenticate('jwt', options.auth),
        cache(options.cache)
      ],
      create: [
        hooks.primaryResource('userMission', { service: 'user-missions' }),
        sanitize(accepts),
        validate(accepts),
      ],
      remove: [
        hooks.primaryResource('userMission', { service: 'user-missions' }),
        sanitize(accepts),
        validate(accepts),
      ]
    },
    after: {
      all: [
        cache(options.cache),
        hooks.responder()
      ],
      create: [
        feeds.notify('mission.join', notifiers)
      ],
      remove: [
        feeds.notify('mission.leave', notifiers)
      ]
    }
  };
}