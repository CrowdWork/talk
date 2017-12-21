const DataLoader = require('dataloader');

const util = require('./util');
const sc = require('snake-case');

const {
  SEARCH_OTHER_USERS,
} = require('../../perms/constants');

const UsersService = require('../../services/users');
const UserModel = require('../../models/user');

const mergeState = (query, state) => {
  const {status} = state;

  if (status) {
    const {username, banned, suspended} = status;

    if (typeof username !== 'undefined' && username && username.length > 0) {
      query.merge({
        'status.username.status': {
          $in: username
        }
      });
    }

    if (typeof banned !== 'undefined' && banned !== null) {
      query.merge({
        'status.banned.status': banned
      });
    }

    if (typeof suspended !== 'undefined' && suspended !== null) {
      if (suspended) {
        query.merge({
          'status.suspension.until': {
            $gte: Date.now()
          }
        });
      } else {
        query.merge({
          $or: [
            {'status.suspension.until': null},
            {'status.suspension.until': {
              $lt: Date.now()
            }}
          ]
        });
      }
    }
  }
};

const genUserByIDs = async (context, ids) => {
  if (!ids || ids.length === 0) {
    return [];
  }

  if (ids.length === 1) {
    const user = await UsersService.findById(ids[0]);
    return [user];
  }

  return UsersService
    .findByIdArray(ids)
    .then(util.singleJoinBy(ids, 'id'));
};

/**
 * Retrieves users based on the passed in query that is filtered by the
 * current used passed in via the context.
 * @param  {Object} context   graph context
 * @param  {Object} query     query terms to apply to the users query
 */
const getUsersByQuery = async ({user}, {ids, limit, cursor, state, action_type, sortOrder}) => {
  let query = UserModel.find();

  if (action_type || state) {
    if (!user || !user.can(SEARCH_OTHER_USERS)) {
      return null;
    }

    if (state) {
      mergeState(query, state);
    }

    if (action_type) {
      query.merge({
        [`action_counts.${sc(action_type.toLowerCase())}`]: {
          $gt: 0
        }
      });
    }
  }

  if (ids) {
    query = query.find({
      id: {
        $in: ids
      }
    });
  }

  if (cursor) {
    if (sortOrder === 'DESC') {
      query = query.where({
        created_at: {
          $lt: cursor
        }
      });
    } else {
      query = query.where({
        created_at: {
          $gt: cursor
        }
      });
    }
  }

  // Apply the limit.
  if (limit) {
    query = query.limit(limit + 1);
  }

  // Sort by created_at.
  query.sort({created_at: sortOrder === 'DESC' ? -1 : 1});

  const nodes = await query.exec();

  // The hasNextPage is always handled the same (ask for one more than we need,
  // if there is one more, than there is more).
  let hasNextPage = false;
  if (limit && nodes.length > limit) {

    // There was one more than we expected! Set hasNextPage = true and remove
    // the last item from the array that we requested.
    hasNextPage = true;
    nodes.splice(limit, 1);
  }

  const startCursor = nodes.length ? nodes[0].created_at : null;
  const endCursor = nodes.length ? nodes[nodes.length - 1].created_at : null;

  return {
    startCursor,
    endCursor,
    hasNextPage,
    nodes,
  };
};

/**
 * Retrieves the count of users based on the passed in query.
 * @param  {Object} context   graph context
 * @param  {Object} query     query to execute against the users collection
 *                            to compute the counts
 * @return {Promise}          resolves to the counts of the users from the
 *                            query
 */
const getCountByQuery = async ({user}, {action_type, state}) => {
  let query = UserModel.find();

  if (action_type || state) {
    if (!user || !user.can(SEARCH_OTHER_USERS)) {
      return null;
    }

    if (state) {
      mergeState(query, state);
    }

    if (action_type) {
      query.merge({
        [`action_counts.${sc(action_type.toLowerCase())}`]: {
          $gt: 0
        }
      });
    }
  }

  return UserModel
    .find(query)
    .count();
};

/**
 * Creates a set of loaders based on a GraphQL context.
 * @param  {Object} context the context of the GraphQL request
 * @return {Object}         object of loaders
 */
module.exports = (context) => ({
  Users: {
    getByQuery: (query) => getUsersByQuery(context, query),
    getByID: new DataLoader((ids) => genUserByIDs(context, ids)),
    getCountByQuery: (query) => getCountByQuery(context, query)
  }
});
