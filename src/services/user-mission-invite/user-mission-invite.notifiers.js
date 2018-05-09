import fp from 'mostly-func';
import { helpers } from 'mostly-feathers-mongoose';

import { createMissionActivity, performersNotifications } from '../../helpers';

// request accept activity
const acceptMission = (context) => {
  const { userMission, activity } = context.params.locals;
  if (!activity || activity.state !== 'ACCEPTED') return;

  const actor = context.params.user.id;
  const inviter = helpers.getId(activity.actor);
  const notifications = performersNotifications(userMission.performers);
  let custom = {
    actor: `user:${actor}`,
    inviter: `user:${inviter}`,
    verb: 'mission.invite.accept',
    message: 'Invite join accept',
    roles: activity.roles
  };
  return [
    createMissionActivity(context, userMission, custom),
    `user:${inviter}`,             // add to inviter's activity log
    `notification:${inviter}`,     // add to inviter's notification stream
    `mission:${userMission.id}`,   // add to mission's activity log
    notifications                  // add to all performers' notification stream
  ];
};

export default {
  'mission.invite.accept': acceptMission
};