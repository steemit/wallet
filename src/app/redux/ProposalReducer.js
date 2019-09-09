import { Map, fromJS } from 'immutable';

const RECEIVE_LIST_PROPOSALS = 'global/RECEIVE_LIST_PROPOSALS';
const RECEIVE_LIST_VOTER_PROPOSALS = 'global/RECEIVE_LIST_VOTER_PROPOSALS';
const RECEIVE_LIST_PROPOSAL_VOTES = 'global/RECEIVE_LIST_PROPOSAL_VOTES';

export const defaultState = Map();

export default function reducer(state = defaultState, action = {}) {
    const payload = action.payload;

    switch (action.type) {
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

export const receiveListProposals = payload => ({
    type: RECEIVE_LIST_PROPOSALS,
    payload,
});

export const receiveListProposalVotes = payload => ({
    type: RECEIVE_LIST_PROPOSAL_VOTES,
    payload,
});
