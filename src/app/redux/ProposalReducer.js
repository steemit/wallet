import { Map, Set, List, fromJS } from 'immutable';

// const ADD_ACTIVE_PROPOSAL_VOTE = 'global/ADD_ACTIVE_PROPOSAL_VOTE';
// const REMOVE_ACTIVE_PROPOSAL_VOTE = 'global/REMOVE_ACTIVE_PROPOSAL_VOTE';
const RECEIVE_LIST_PROPOSALS = 'global/RECEIVE_LIST_PROPOSALS';
const RECEIVE_LIST_VOTER_PROPOSALS = 'global/RECEIVE_LIST_VOTER_PROPOSALS';
const RECEIVE_LIST_PROPOSAL_VOTES = 'global/RECEIVE_LIST_PROPOSAL_VOTES';

export const defaultState = Map();

export default function reducer(state = defaultState, action = {}) {
    const payload = action.payload;

    switch (action.type) {
        // case ADD_ACTIVE_PROPOSAL_VOTE: {
        //     return state.update(
        //         `transaction_proposal_vote_active_${payload.voter}`,
        //         List(),
        //         l => l.push(payload.proposal_ids[0])
        //     );
        // }
        //
        // case REMOVE_ACTIVE_PROPOSAL_VOTE: {
        //     return state.update(
        //         `transaction_proposal_vote_active_${payload.voter}`,
        //         List(),
        //         l => l.delete(l.indexOf(payload.proposal_ids[0]))
        //     );
        // }

        case RECEIVE_LIST_PROPOSALS: {
            const new_state = fromJS(payload);
            return state.merge(new_state);
        }

        case RECEIVE_LIST_VOTER_PROPOSALS: {
            const new_state = fromJS(payload);
            return state.merge(new_state);
        }

        case RECEIVE_LIST_PROPOSAL_VOTES: {
            const new_state = fromJS(payload);
            return state.merge(new_state);
        }

        default:
            return state;
    }
}

// export const addActiveProposalVote = payload => ({
//     type: ADD_ACTIVE_PROPOSAL_VOTE,
//     payload,
// });
//
// export const removeActiveProposalVote = payload => ({
//     type: REMOVE_ACTIVE_PROPOSAL_VOTE,
//     payload,
// });

export const receiveListProposals = payload => ({
    type: RECEIVE_LIST_PROPOSALS,
    payload,
});

// export const receiveListVoterProposals = payload => ({
//     type: RECEIVE_LIST_VOTER_PROPOSALS,
//     payload,
// });

export const receiveListProposalVotes = payload => ({
    type: RECEIVE_LIST_PROPOSAL_VOTES,
    payload,
});
