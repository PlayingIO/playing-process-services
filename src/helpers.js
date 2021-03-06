const assert = require('assert');
const fp = require('mostly-func');
const { helpers } = require('mostly-feathers-mongoose');
const rules = require('playing-rule-common');

const fulfillActivityRequires = (activity, user) => {
  return rules.fulfillRequires(user, [], activity.requires);
};

const fulfillActivityRewards = (activity, user) => {
  return rules.fulfillCustomRewards(fp.pick(['requires', 'rewards'], activity), [], user);
};

/**
 * get available task of an activity at a given keys, based by previous task state
 */
const getReadyTask = (user, tasks, keys, activity, previous) => {
  const key = keys.join('.');
  const task = fp.find(fp.propEq('key', key), tasks);
  const rewards = fp.map(reward => {
    const metric = fp.pickPath(['metric', 'metric.id', 'metric.name', 'metric.type'], reward);
    return fp.assoc('metric', metric.metric, reward);
  }, activity.rewards || []);

  if (!previous || previous.state === 'COMPLETED') {
    if (task && task.name == activity.name) { // check name with key
      if (task.state !== 'COMPLETED') {
        return fp.assoc('rewards', rewards, task);
      }
    } else if (fulfillActivityRequires(activity, user)) {
      return { key, name: activity.name, state: 'READY', rewards: rewards, loop: 0 };
    }
  }
  return null;
};

/**
 * Walk throught activities of mission to get ready activities,
 * and update state of sequential/parallel/exclusive node.
 */
const walkThroughTasksReady = (user, tasks = [], keys = [], previous = null, keepPrevious = false) => (activities) => {
  return fp.reduceIndexed((acc, activity, index) => {
    const task = getReadyTask(user, tasks, [...keys, index], activity, previous);
    if (!task) return acc; // break

    const subActivities = activity.activities || [];
    switch (activity.type) {
      case 'single': {
        acc = acc.concat([task]);
        previous = keepPrevious? previous : task;
        break;
      }
      case 'sequential': {
        const subTasks = walkThroughTasksReady(user, tasks, [...keys, index], previous)(subActivities);
        const completed = fp.filter(fp.propEq('state', 'COMPLETED'), subTasks);
        if (completed.length == subActivities.length) { // all completed
          task.state = 'COMPLETED';
        } else {
          task.state = completed.length? 'ACTIVE' : 'READY';
        }
        acc = acc.concat(subTasks);
        previous = task;
        break;
      }
      case 'parallel': {
        const subTasks = walkThroughTasksReady(user, tasks, [...keys, index], previous, true)(subActivities);
        const completed = fp.filter(fp.propEq('state', 'COMPLETED'), subTasks);
        if (completed.length == subActivities.length) { // all completed
          task.state = 'COMPLETED';
        } else {
          task.state = 'READY';
        }
        acc = acc.concat(subTasks);
        previous = task;
        break;
      }
      case 'exclusive': {
        const subTasks = walkThroughTasksReady(user, tasks, [...keys, index], previous, true)(subActivities);
        const completed = fp.filter(fp.propEq('state', 'COMPLETED'), subTasks);
        if (completed.length > 0) { // any completed
          task.state = 'COMPLETED';
          acc = acc.concat(completed);
        } else {
          task.state = 'READY';
          acc = acc.concat(subTasks);
        }
        previous = task;
        break;
      }
    }
    return acc;
  }, [], activities);
};

const getRecursiveRequires = (path) => (activities) => {
  return fp.reduce((arr, activity) => {
    if (activity.type === 'single') {
      arr.push(fp.dotPath(path, activity) || []);
    } else {
      arr.push(fp.flatten(getRecursiveRequires(path)(activity.activities || [])));
    }
    return arr;
  }, [], activities);
};

const getRecursiveRewards = (path) => (activities) => {
  return fp.reduce((arr, activity) => {
    if (activity.type === 'single') {
      return arr.concat(fp.dotPath(path, activity) || []);
    } else {
      return arr.concat(fp.flatten(getRecursiveRewards(path)(activity.activities || [])));
    }
  }, [], activities);
};

// default mission lanes
const defaultLane = (service, id) => async (params) => {
  const mission = await service.get(params[id]);
  if (mission && mission.lanes) {
    const lane = fp.find(fp.propEq('default', true), mission.lanes);
    return lane? lane.name : null;
  }
  return null;
};

// validator for roles
const rolesExists = (service, id, message) => async (val, params) => {
  assert(params[id], `rolesExists '${id}' is not exists in validation params`);
  const userMission = fp.isIdLike(params[id])?
    await service.get(params[id], { query: { $select: 'definition,*' } }) : params[id];
  const lanes = fp.keys(val), roles = fp.values(val);
  if (userMission && userMission.definition && userMission.definition.lanes) {
    if (fp.includesAll(lanes, fp.map(fp.prop('name'), userMission.definition.lanes))
      && fp.includesAll(roles, ['player', 'observer'])) return;
  } else {
    message = 'User mission is not exists';
  }
  return message;
};

// default roles
const defaultRoles = (service, id) => async (params) => {
  const userMission = await service.get(params[id], { query: { $select: 'definition,*' } });
  if (userMission && userMission.definition && userMission.definition.lanes) {
    const lane = fp.find(fp.propEq('default', true), userMission.definition.lanes);
    return lane? { [lane.name] : 'player' } : null;
  }
  return null;
};

// create a user mission activity
const createMissionActivity = (context, userMission, custom) => {
  const actor = helpers.getId(userMission.owner);
  const definition = helpers.getId(userMission.definition);
  return {
    actor: `user:${actor}`,
    object: `userMission:${userMission.id}`,
    foreignId: `userMission:${userMission.id}`,
    time: new Date().toISOString(),
    definition: `mission-design:${definition}`,
    ...custom
  };
};

// notification feeds of all performers
const performersNotifications = function (performers, excepts = []) {
  const users = fp.without(excepts, fp.map(fp.prop('user'), performers || []));
  return fp.map(fp.concat('notification:'), users);
};

/**
 * Add roles of performer
 */
const addUserMissionRoles = async (app, userMission, user, lanes) => {
  const svcUserMissions = app.service('user-missions');
  await svcUserMissions.patch(userMission.id, {
    $addToSet: {
      performers: { user, lanes }
    }
  });
};

/**
 * Update roles of performer
 */
const updateUserMissionRoles = async (app, userMission, user, lanes, params = {}) => {
  const svcUserMissions = app.service('user-missions');
  params.query = fp.assignAll(params.query, {
    'performers.user': user
  });
  const updates = fp.reduce((acc, lane) => {
    if (lanes[lane] !== 'false') {
      acc[`performers.$.lanes.${lane}`] = lanes[lane];
    } else {
      acc['$unset'] = acc['$unset'] || [];
      acc['$unset'].push({ [`performers.$.lanes.${lane}`]: '' });
    }
    return acc;
  }, {}, fp.keys(lanes));
  return svcUserMissions.patch(userMission.id, updates, params);
};

module.exports = {
  addUserMissionRoles,
  createMissionActivity,
  defaultLane,
  defaultRoles,
  getRecursiveRequires,
  getRecursiveRewards,
  fulfillActivityRequires,
  fulfillActivityRewards,
  performersNotifications,
  rolesExists,
  updateUserMissionRoles,
  walkThroughTasksReady
};