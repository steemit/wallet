import React from 'react';
import { connect } from 'react-redux';
import { actions as proposalActions } from 'app/redux/ProposalSaga';
import * as transactionActions from 'app/redux/TransactionReducer'; // TODO: Only import what we need.

import { List } from 'immutable';
// import tt from 'counterpart';
// import { FormattedDate, FormattedTime } from 'react-intl';
// import Icon from 'app/components/elements/Icon';

// import Pagination from '../elements/Pagination';
// import DropdownMenu from '../elements/DropdownMenu';

import PropTypes from 'prop-types';

import ProposalListContainer from 'app/components/modules/ProposalList/ProposalListContainer';

class Proposals extends React.Component {
    constructor(props) {
        super(props);
        this.state = { proposals: [], userProposals: [] };
    }
    async componentWillMount() {
        const proposals = (await this.getAllProposals(10, 'all', 0)) || [];
        const userProposals = (await this.getAllProposals(10, 'all', 0)) || [];
        console.log('componentWillMount', proposals, userProposals);
        this.setState({ proposals, userProposals });
    }

    getAllProposals(
        limit,
        status,
        last_id,
        order_by = 'by_creator',
        order_direction = 'ascending',
        start = ''
    ) {
        if (status === 'voted') {
            start = this.props.currentUser;
        }
        return this.props.listProposals({
            start,
            limit,
            order_by,
            order_direction,
            status,
        });
    }

    getUserProposals(
        limit,
        status,
        last_id,
        order_by = 'by_creator',
        order_direction = 'ascending',
        start = ''
    ) {
        if (!this.props.currentUser) return [];

        // if (status === 'voted') {
        start = this.props.currentUser;
        // }
        return this.props.listProposalsByVoter({
            start,
            limit,
            order_by,
            order_direction,
            status,
        });
    }

    upvoteProposal = proposalId => {
        return this.props.upvoteProposal(
            this.props.currentUser,
            [proposalId],
            true
        );
    };

    render() {
        const { proposals } = this.state;
        return (
            <div>
                <ProposalListContainer
                    upvoteProposal={this.upvoteProposal}
                    proposals={proposals}
                />
            </div>
        );
    }
}

Proposals.propTypes = {
    listProposals: PropTypes.func.isRequired,
    listProposalsByVoter: PropTypes.func.isRequired,
    removeProposal: PropTypes.func.isRequired,
    updateProposalVotes: PropTypes.func.isRequired,
    createProposal: PropTypes.func.isRequired,
    upvoteProposal: PropTypes.func.isRequired,
};

module.exports = {
    path: 'proposals',
    component: connect(
        state => {
            console.log('state.proposal', state.proposal.toJS());
            const user = state.user.get('current');
            const currentUser = user && user.get('username');
            const proposals = state.proposal.get('proposals', List());
            const last = proposals.size - 1;
            const last_id =
                (proposals.size && proposals.get(last).get('id')) || null;
            const newProposals =
                proposals.size >= 10 ? proposals.delete(last) : proposals;
            const voterProposals = state.proposal.get('voterProposals', List());
            const votesInProgress = state.proposal.get(
                `transaction_proposal_vote_active_${currentUser}`,
                List()
            );

            return {
                currentUser,
                proposals: newProposals,
                voterProposals,
                last_id,
                votesInProgress,
            };
        },
        dispatch => {
            const successCallback = () => {
                console.log('successCallback', arguments);
                dispatch(
                    proposalActions.listProposals({
                        start: '',
                        limit: 1000,
                        order_by: 'by_creator',
                        order_direction: 'ascending',
                        status: 'all',
                    })
                );
                dispatch(
                    proposalActions.listVoterProposals({
                        start: proposal_owner,
                        limit: 1000,
                        order_by: 'by_creator',
                        order_direction: 'ascending',
                        status: 'all',
                    })
                );
            };
            const errorCallback = () => {
                console.log('errorCallback', arguments);
                // dispatch(
                //     proposalActions.listProposals({
                //         start: '',
                //         limit: 11,
                //         order_by: 'by_creator',
                //         order_direction: 'ascending',
                //         status: 'all',
                //     })
                // );
                // dispatch(
                //     proposalActions.listVoterProposals({
                //         start: proposal_owner,
                //         limit: 1000,
                //         order_by: 'by_creator',
                //         order_direction: 'ascending',
                //         status: 'all',
                //     })
                // );
            };
            return {
                upvoteProposal: (voter, proposal_ids, approve) => {
                    dispatch(
                        transactionActions.broadcastOperation({
                            type: 'update_proposal_votes',
                            operation: { voter, proposal_ids, approve },
                            successCallback,
                            errorCallback,
                        })
                    );
                },
                createProposal: (
                    creator,
                    receiver,
                    start_date,
                    end_date,
                    daily_pay,
                    subject,
                    permlink
                ) => {
                    console.log('create_proposal', arguments);
                    dispatch(
                        transactionActions.broadcastOperation({
                            type: 'create_proposal',
                            operation: {
                                creator,
                                receiver,
                                start_date: '2019-07-20T11:22:39',
                                end_date: '2019-08-30T11:22:39',
                                daily_pay: '3000.000 TBD',
                                subject: 'Test Proposal',
                                permlink: 'remove-delegations',
                            },
                            successCallback,
                            errorCallback,
                        })
                    );
                },
                removeProposal: (proposal_owner, proposal_ids) => {
                    dispatch(
                        transactionActions.broadcastOperation({
                            type: 'remove_proposal',
                            operation: { proposal_owner, proposal_ids },
                            confirm: tt(
                                'steem_proposal_system_jsx.confirm_remove_proposal_description'
                            ),
                            successCallback,
                            errorCallback,
                        })
                    );
                },
                listProposals: payload =>
                    new Promise((resolve, reject) => {
                        dispatch(
                            proposalActions.listProposals({
                                ...payload,
                                resolve,
                                reject,
                            })
                        );
                    }),
                listProposalsByVoter: payload =>
                    new Promise((resolve, reject) => {
                        dispatch(
                            proposalActions.listVoterProposals({
                                ...payload,
                                resolve,
                                reject,
                            })
                        );
                    }),
            };
        }
    )(Proposals),
};
