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
        this.state = {
            proposals: [],
            loading: true,
            limit: 10,
            last_proposal: false,
            status: 'all',
        };
    }
    async componentWillMount() {
        await this.load();
        console.log('componentWillMount', this.state);
    }

    async load(quiet = false) {
        console.log('load', this.state);
        // if (this.state.proposals && this.state.proposals.length > 0) {
        //     this.setState({ loading: false });
        // } else {
        if (quiet) {
            this.setState({ loading: true });
        }
        // }

        const proposals =
            (await this.getAllProposals(
                this.state.last_proposal,
                'by_total_votes',
                // 'by_creator',
                // 'ascending',
                'descending',
                this.state.limit + this.state.proposals.length,
                this.state.status
            )) || [];
        // const userProposals = (await this.getAllProposals(100, 'all', 0)) || [];
        // const upvotedProposals =
        //     (await this.getUpvotedProposals(100, 'all', 0)) || [];
        console.log(
            'Proposals->load',
            proposals
            // userProposals,
            // upvotedProposals
        );
        let last_proposal = false;
        if (proposals.length > 0) {
            last_proposal = proposals[0];
        }

        this.setState({
            proposals,
            loading: false,
            last_proposal,
        });
    }

    getAllProposals(last_proposal, order_by, order_direction, limit, status) {
        // if (status === 'voted') {
        //     start = this.props.currentUser;
        // }export function* listProposals({
        return this.props.listProposals({
            voter_id: this.props.currentUser,
            last_proposal,
            order_by,
            order_direction,
            limit,
            status,
        });
    }
    //
    // getUserProposals(
    //     limit,
    //     status = 'all',
    //     last_id,
    //     order_by = 'by_creator',
    //     order_direction = 'ascending',
    //     start = ''
    // ) {
    //     if (!this.props.currentUser) return [];
    //
    //     // if (status === 'voted') {
    //     start = this.props.currentUser;
    //     // }
    //     return this.props.listProposalsByVoter({
    //         start,
    //         limit,
    //         order_by,
    //         order_direction,
    //         status,
    //     });
    // }
    //
    // getUpvotedProposals(
    //     limit = 1000,
    //     status = 'all',
    //     order_by = 'by_creator',
    //     order_direction = 'ascending'
    // ) {
    //     // if (this.props.currentUser) {
    //     return this.props.listVotedOnProposals({
    //         voter_id: this.props.currentUser,
    //         limit,
    //         order_by: 'by_proposal_voter',
    //         order_direction,
    //         status,
    //     });
    //     // }
    //     // return [];
    // }

    // voteOnProposal = (proposalId, voteForIt, onSuccess, onFailure) => {
    //     return this.props.voteOnProposal(
    //         this.props.currentUser,
    //         [proposalId],
    //         voteForIt,
    //         onSuccess,
    //         onFailure
    //     );
    // };

    voteOnProposal = async (proposalId, voteForIt, onSuccess, onFailure) => {
        return this.props.voteOnProposal(
            this.props.currentUser,
            [proposalId],
            voteForIt,
            async () => {
                if (onSuccess) onSuccess();
            },
            () => {
                if (onFailure) onFailure();
            }
        );
    };

    onClickLoadMoreProposals = e => {
        e.preventDefault();
        console.log('onClickLoadMoreProposals::clicked');
        this.load();
    };

    render() {
        console.log('Proposals->render()', this.state);
        const { proposals, loading } = this.state;
        const { total_vesting_shares, total_vesting_fund_steem } = this.props;
        let showBottomLoading = false;
        if (loading && proposals && proposals.length > 0) {
            showBottomLoading = true;
        }
        return (
            <div>
                <ProposalListContainer
                    voteOnProposal={this.voteOnProposal}
                    proposals={proposals}
                    loading={loading}
                    total_vesting_shares={total_vesting_shares}
                    total_vesting_fund_steem={total_vesting_fund_steem}
                />
                <center style={{ paddingTop: '1em', paddingBottom: '1em' }}>
                    {!loading ? (
                        <a href="#" onClick={this.onClickLoadMoreProposals}>
                            {`Load more...`}
                        </a>
                    ) : null}

                    {showBottomLoading ? <a>{`Loading more...`}</a> : null}
                </center>
            </div>
        );
    }
}

Proposals.propTypes = {
    listProposals: PropTypes.func.isRequired,
    // listVotedOnProposals: PropTypes.func.isRequired,
    removeProposal: PropTypes.func.isRequired,
    // updateProposalVotes: PropTypes.func.isRequired,
    createProposal: PropTypes.func.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
    total_vesting_shares: PropTypes.number.isRequired,
    total_vesting_fund_steem: PropTypes.number.isRequired,
};

module.exports = {
    path: 'proposals',
    component: connect(
        state => {
            console.log('state.proposal', state.proposal.toJS());
            const user = state.user.get('current');
            console.log("const user = state.user.get('current');", user);
            const currentUser = user && user.get('username');
            console.log(
                "const currentUser = user && user.get('username');",
                currentUser
            );
            const proposals = state.proposal.get('proposals', List());
            const last = proposals.size - 1;
            const last_id =
                (proposals.size && proposals.get(last).get('id')) || null;
            const newProposals =
                proposals.size >= 10 ? proposals.delete(last) : proposals;
            // const voterProposals = state.proposal.get('voterProposals', List());
            // const votesInProgress = state.proposal.get(
            //     `transaction_proposal_vote_active_${currentUser}`,
            //     List()
            // );
            const total_vesting_shares = state.global.getIn([
                'props',
                'total_vesting_shares',
            ]);
            const total_vesting_fund_steem = state.global.getIn([
                'props',
                'total_vesting_fund_steem',
            ]);

            return {
                currentUser,
                proposals: newProposals,
                total_vesting_shares,
                total_vesting_fund_steem,
                last_id,
            };
        },
        dispatch => {
            // const successCallback = () => {
            //     console.log('successCallback', arguments);
            //     dispatch(
            //         proposalActions.listProposals({
            //             start: '',
            //             limit: 1000,
            //             order_by: 'by_creator',
            //             order_direction: 'ascending',
            //             status: 'all',
            //         })
            //     );
            //     // dispatch(
            //     //     proposalActions.listVoterProposals({
            //     //         start: proposal_owner,
            //     //         limit: 1000,
            //     //         order_by: 'by_creator',
            //     //         order_direction: 'ascending',
            //     //         status: 'all',
            //     //     })
            //     // );
            // };
            // const errorCallback = () => {
            //     console.log('errorCallback', arguments);
            //     // dispatch(
            //     //     proposalActions.listProposals({
            //     //         start: '',
            //     //         limit: 11,
            //     //         order_by: 'by_creator',
            //     //         order_direction: 'ascending',
            //     //         status: 'all',
            //     //     })
            //     // );
            //     // dispatch(
            //     //     proposalActions.listVoterProposals({
            //     //         start: proposal_owner,
            //     //         limit: 1000,
            //     //         order_by: 'by_creator',
            //     //         order_direction: 'ascending',
            //     //         status: 'all',
            //     //     })
            //     // );
            // };
            return {
                voteOnProposal: (
                    voter,
                    proposal_ids,
                    approve,
                    successCallback,
                    errorCallback
                ) => {
                    console.log('voteOnProposal', arguments);
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
                    permlink,
                    successCallback,
                    errorCallback
                ) => {
                    console.log('createProposal', arguments);
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
                removeProposal: (
                    proposal_owner,
                    proposal_ids,
                    successCallback,
                    errorCallback
                ) => {
                    console.log('removeProposal', arguments);
                    dispatch(
                        transactionActions.broadcastOperation({
                            type: 'remove_proposal',
                            operation: { proposal_owner, proposal_ids },
                            confirm: tt(
                                'steem_proposals.confirm_remove_proposal_description'
                            ),
                            successCallback,
                            errorCallback,
                        })
                    );
                },
                listProposals: payload => {
                    console.log('listProposals', arguments);
                    return new Promise((resolve, reject) => {
                        dispatch(
                            proposalActions.listProposals({
                                ...payload,
                                resolve,
                                reject,
                            })
                        );
                    });
                },
                // listVotedOnProposals: payload =>
                //     new Promise((resolve, reject) => {
                //         dispatch(
                //             proposalActions.listVotedOnProposals({
                //                 ...payload,
                //                 resolve,
                //                 reject,
                //             })
                //         );
                //     }),
            };
        }
    )(Proposals),
};
