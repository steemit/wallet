import React from 'react';
import { connect } from 'react-redux';
import { actions as proposalActions } from 'app/redux/ProposalSaga';
import * as transactionActions from 'app/redux/TransactionReducer'; // TODO: Only import what we need.
import * as appActions from 'app/redux/AppReducer';
import { List } from 'immutable';
import PropTypes from 'prop-types';
import { api } from '@steemit/steem-js';
import ProposalListContainer from 'app/components/modules/ProposalList/ProposalListContainer';
import {
    LOAD_ALL_VOTERS,
    MAX_INITIAL_LOAD,
    INITIAL_TIMEOUT,
    MAX_TIMEOUT,
} from 'app/components/modules/ProposalList/constants';
import VotersModal from 'app/components/elements/VotersModal';
import ProposalCreatorModal from 'app/components/elements/ProposalCreatorModal';
import tt from 'counterpart';

class Proposals extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            proposals: [],
            loading: true,
            limit: 50,
            last_proposal: false,
            status: 'votable',
            order_by: 'by_total_votes',
            order_direction: 'descending',
            open_voters_modal: false,
            open_creators_modal: false,
            voters: [],
            voters_accounts: [],
            total_vests: '',
            total_vest_steem: '',
            new_id: '',
            is_voters_data_loaded: false,
            lastVoter: '',
            paid_proposals: [],
        };
        this.fetchVoters = this.fetchVoters.bind(this);
        this.fetchGlobalProps = this.fetchGlobalProps.bind(this);
        this.fetchDataForVests = this.fetchDataForVests.bind(this);
        this.setIsVotersDataLoading = this.setIsVotersDataLoading.bind(this);
        this.getVotedProposals = this.getVotedProposals.bind(this);
    }
    async componentWillMount() {
        this.props.setRouteTag();
        await this.load();
    }
    componentDidMount() {
        this.fetchGlobalProps();
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevState.new_id !== this.state.new_id) {
            this.fetchVoters();
            this.setIsVotersDataLoading(false);
        }
        if (prevState.voters !== this.state.voters) {
            this.fetchDataForVests();
        }
        if (prevState.voters_accounts !== this.state.voters_accounts) {
            this.setIsVotersDataLoading(!this.state.is_voters_data_loaded);
        }
        if (prevProps.currentUser !== this.props.currentUser) {
            this.updateProposalVotes(this.props.currentUser);
        }
    }

    getStartValue(order_by, order_direction) {
        const minDate = '1970-01-01T00:00:00';
        const maxDate = '2038-01-19T03:14:07';
        const startValueByOrderType = {
            by_total_votes: {
                ascending: [0],
                descending: [-1, 0],
            },
            by_creator: {
                ascending: [''],
                descending: ['zzzzzzzzzzzzzz'],
            },
            by_start_date: {
                ascending: [minDate],
                descending: [maxDate],
            },
            by_end_date: {
                ascending: [minDate],
                descending: [maxDate],
            },
        };
        const value = startValueByOrderType[order_by][order_direction];
        return value;
    }

    async load(quiet = false, options = {}) {
        if (quiet) {
            this.setState({ loading: true });
        }

        const { status, order_by, order_direction } = options;

        const isFiltering = !!(status || order_by || order_direction);

        let limit;

        if (isFiltering) {
            limit = this.state.limit;
        } else {
            limit = this.state.limit + this.state.proposals.length;
        }

        const start = this.getStartValue(
            order_by || this.state.order_by,
            order_direction || this.state.order_direction
        );
        const proposals =
            (await this.getAllProposals(
                this.state.last_proposal,
                order_by || this.state.order_by,
                order_direction || this.state.order_direction,
                limit,
                status || this.state.status,
                start
            )) || [];
        let last_proposal = false;
        if (proposals.length > 0) {
            last_proposal = proposals[0];
        }
        this.setState({
            proposals,
            loading: false,
            last_proposal,
            limit,
        });
    }

    onFilterProposals = async status => {
        this.setState({ status });
        await this.load(false, { status });
    };

    onOrderProposals = async order_by => {
        this.setState({ order_by });
        await this.load(false, { order_by });
    };

    onOrderDirection = async order_direction => {
        this.setState({ order_direction });
        await this.load(false, { order_direction });
    };

    getVotersAccounts = voters_accounts => {
        this.setState({ voters_accounts });
    };

    getVoters = (voters, lastVoter) => {
        this.setState({ voters, lastVoter });
    };

    getNewId = new_id => {
        this.setState({ new_id });
    };

    setIsVotersDataLoading = is_voters_data_loaded => {
        this.setState({ is_voters_data_loaded });
    };
    setPaidProposals = paid_proposals => {
        this.setState({ paid_proposals });
    };

    getAllProposals(
        last_proposal,
        order_by,
        order_direction,
        limit,
        status,
        start
    ) {
        return this.props.listProposals({
            voter_id: this.props.currentUser,
            last_proposal,
            order_by,
            order_direction,
            limit,
            status,
            start,
        });
    }

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

    fetchGlobalProps() {
        api.callAsync('condenser_api.get_dynamic_global_properties', [])
            .then(res =>
                this.setState({
                    total_vests: res.total_vesting_shares,
                    total_vest_steem: res.total_vesting_fund_steem,
                })
            )
            .catch(err => console.log(err));
    }

    fetchVoters() {
        this.fetchAllVotersWithPause({
            proposalId: this.state.new_id,
            timeout: INITIAL_TIMEOUT,
            maxToLoad: LOAD_ALL_VOTERS ? null : MAX_INITIAL_LOAD,
        })
            .then(res => {
                this.getVoters(res, ...res.slice(-1));
            })
            .catch(err => console.log(err));
    }

    fetchDataForVests() {
        const voters = this.state.voters;
        const new_id = this.state.new_id;

        const selected_proposal_voters = voters.filter(
            v => v.proposal.proposal_id === new_id
        );
        const voters_map = selected_proposal_voters.map(name => name.voter);
        api.getAccountsAsync(voters_map)
            .then(res => this.getVotersAccounts(res))
            .catch(err => console.log(err));
    }

    async getVotedProposals({ accountName, proposalIdsSet }) {
        const votedMap = {};

        try {
            const result = await new Promise((resolve, reject) => {
                api.callAsync(
                    'database_api.list_proposal_votes',
                    {
                        start: [accountName],
                        limit: 1000,
                        order: 'by_voter_proposal',
                        order_direction: 'ascending',
                        status: 'all',
                    },
                    (err, res) => {
                        if (err) reject(err);
                        else resolve(res);
                    }
                );
            });

            const votes = (result && result.proposal_votes) || [];
            if (votes.length === 0 || votes[0].voter !== accountName) {
                return votedMap;
            }

            for (const vote of votes) {
                if (vote.voter !== accountName) break;
                const proposalId = vote.proposal.proposal_id;
                if (proposalIdsSet.has(proposalId)) {
                    votedMap[proposalId] = true;
                }
            }

            return votedMap;
        } catch (err) {
            console.error('Error al obtener propuestas votadas:', err);
            return votedMap;
        }
    }

    async updateProposalVotes(currentUser) {
        if (typeof currentUser !== 'string' || currentUser.length <= 1) return;

        const { proposals } = this.state;
        const proposalIdsSet = new Set(proposals.map(p => p.id));
        const votedMap = await this.getVotedProposals({ accountName: currentUser, proposalIdsSet });

        const updatedProposals = proposals.map(p => ({
            ...p,
            upVoted: !!votedMap[p.id],
        }));

        this.setState({ proposals: updatedProposals });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async fetchAllVotersWithPause({
        proposalId,
        lastVoter = '',
        accumulated = [],
        timeout = INITIAL_TIMEOUT,
        maxToLoad = null,
    }) {
        try {
            const res = await new Promise((resolve, reject) => {
                api.callAsync(
                    'database_api.list_proposal_votes',
                    {
                        start: [proposalId, lastVoter],
                        limit: 1000,
                        order: 'by_proposal_voter',
                        order_direction: 'ascending',
                        status: 'active',
                    },
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });

            const votes = (res && res.proposal_votes) || [];
            if (votes.length === 0) return accumulated;
            const allVoters = accumulated.concat(votes);
            if (maxToLoad && allVoters.length >= maxToLoad) {
                return allVoters.slice(0, maxToLoad);
            }
            if (votes.length < 1000) {
                return allVoters;
            }
            if (votes && votes.length >= 2) {
                try {
                    const firstProposalId = votes[0].proposal.proposal_id;
                    const lastProposalId = votes.at(-1).proposal.proposal_id;
                    if (
                        firstProposalId !== proposalId ||
                        lastProposalId !== proposalId
                    ) {
                        return allVoters;
                    }
                } catch (error) {
                    console.error(error);
                }
            }
            const nextVoter = votes.at(-1) ? votes.at(-1).voter : undefined;
            await this.delay(timeout);
            const nextTimeout = Math.min(timeout + 250, MAX_TIMEOUT);
            return this.fetchAllVotersWithPause({
                proposalId,
                lastVoter: nextVoter,
                accumulated: allVoters,
                timeout: nextTimeout,
                maxToLoad,
            });
        } catch (err) {
            console.error('Error al obtener votantes:', err);
            return accumulated;
        }
    }

    onClickLoadMoreProposals = e => {
        e.preventDefault();
        this.load();
    };

    triggerCreatorsModal = () => {
        this.setState({
            open_creators_modal: !this.state.open_creators_modal,
        });
    };

    triggerVotersModal = () => {
        this.setState({
            open_voters_modal: !this.state.open_voters_modal,
        });
    };

    submitProposal = (proposal, onSuccess, onFailure) => {
        this.props.createProposal(
            this.props.currentUser || proposal.creator,
            proposal.receiver,
            proposal.startDate,
            proposal.endDate,
            `${parseFloat(proposal.dailyAmount).toFixed(3)} SBD`,
            proposal.title,
            proposal.permlink,
            async () => {
                this.triggerCreatorsModal();
                if (onSuccess) onSuccess();
            },
            () => {
                if (onFailure) onFailure();
            }
        );
    };

    removeProposalById = id => {
        this.setState(prevState => ({
            proposals: prevState.proposals.filter(
                proposal => proposal.id !== id
            ),
        }));
    };

    render() {
        const {
            proposals,
            loading,
            status,
            order_by,
            order_direction,
            voters,
            voters_accounts,
            open_creators_modal,
            open_voters_modal,
            total_vests,
            total_vest_steem,
            is_voters_data_loaded,
            new_id,
        } = this.state;

        const mergeVoters = [...voters];

        const { nightmodeEnabled } = this.props;

        let showBottomLoading = false;
        if (loading && proposals && proposals.length > 0) {
            showBottomLoading = true;
        }
        const selected_proposal_voters = mergeVoters.filter(
            v => v.proposal.proposal_id === new_id
        );
        const voters_map = selected_proposal_voters.map(name => name.voter); // voter name
        const accounts_map = [];
        const acc_proxied_vests = [];
        const proxies_name_by_voter = [];
        const proxies_vote = {};
        voters_accounts.forEach(acc => {
            accounts_map.push(acc.vesting_shares);
            const proxied = acc.proxied_vsf_votes
                .map(r => parseInt(r, 10))
                .reduce((a, b) => a + b, 0);
            acc_proxied_vests.push(proxied);
            proxies_name_by_voter.push(acc.proxy);
            if (acc.proxy) {
                proxies_vote[acc.proxy] = false;
            }
        });
        const steem_power = [];
        const proxy_sp = [];
        const total_sp = [];
        let global_total_sp = 0;

        const calculatePowers = () => {
            const total_vestsNew = parseFloat(total_vests.split(' ')[0]);
            const total_vest_steemNew = parseFloat(
                total_vest_steem.split(' ')[0]
            );

            for (let i = 0; i < accounts_map.length; i++) {
                const vests_account = parseFloat(accounts_map[i].split(' ')[0]);
                const vests_proxy = acc_proxied_vests[i];

                const vesting_steem_account =
                    total_vest_steemNew * (vests_account / total_vestsNew);
                const vesting_steem_proxy =
                    total_vest_steemNew *
                    (vests_proxy / total_vestsNew) *
                    0.000001;

                const total = vesting_steem_account + vesting_steem_proxy;

                steem_power.push(vesting_steem_account);
                proxy_sp.push(vesting_steem_proxy);
                total_sp.push(total);
                const voter = voters_map[i];
                if (Object.keys(proxies_vote).includes(voter)) {
                    proxies_vote[voter] = true;
                }
                global_total_sp += total;
            }
        };
        calculatePowers();
        const simpleVotesToSp = total_votes => {
            const total_vestsNew = parseFloat(total_vests.split(' ')[0]);
            const total_vest_steemNew = parseFloat(
                total_vest_steem.split(' ')[0]
            );
            return (
                total_vest_steemNew *
                (total_votes / total_vestsNew) *
                0.000001
            ).toFixed(2);
        };
        const pro_aux = proposals.find(p => p.proposal_id === new_id);
        let total_votes_aux = 0;
        if (pro_aux && pro_aux.total_votes) {
            total_votes_aux = simpleVotesToSp(pro_aux.total_votes);
        }
        const total_acc_sp_obj = {};
        voters_map.forEach((voter, i) => {
            const proxy_name = proxies_name_by_voter[i];
            const proxy_vote = proxies_vote[proxy_name] || false;
            const influence = total_votes_aux
                ? (total_sp[i] / total_votes_aux) * 100
                : 0;
            total_acc_sp_obj[voter] = [
                total_sp[i],
                steem_power[i],
                proxy_sp[i],
                proxy_name,
                proxy_vote,
                influence,
            ];
        });
        const sort_merged_total_sp = [];
        for (const value in total_acc_sp_obj) {
            sort_merged_total_sp.push([value, ...total_acc_sp_obj[value]]);
        }
        sort_merged_total_sp.sort((a, b) => b[1] - a[1]);

        return (
            <div>
                <VotersModal
                    new_id={new_id}
                    is_voters_data_loaded={is_voters_data_loaded}
                    sort_merged_total_sp={sort_merged_total_sp}
                    open_modal={open_voters_modal}
                    close_modal={this.triggerVotersModal}
                    nightmodeEnabled={nightmodeEnabled}
                    total_sp_votes={total_votes_aux}
                />
                <ProposalCreatorModal
                    open_modal={open_creators_modal}
                    close_modal={this.triggerCreatorsModal}
                    submit_proposal={this.submitProposal}
                    nightmodeEnabled={nightmodeEnabled}
                />
                <ProposalListContainer
                    voteOnProposal={this.voteOnProposal}
                    proposals={proposals}
                    loading={loading}
                    status={status}
                    orderBy={order_by}
                    orderDirection={order_direction}
                    onFilter={this.onFilterProposals}
                    onOrder={this.onOrderProposals}
                    onOrderDirection={this.onOrderDirection}
                    getNewId={this.getNewId}
                    getVoters={this.getVoters}
                    triggerVotersModal={this.triggerVotersModal}
                    triggerCreatorsModal={this.triggerCreatorsModal}
                    currentUser={this.props.currentUser}
                    removeProposalById={this.removeProposalById}
                    setPaidProposals={this.setPaidProposals}
                    paid_proposals={this.state.paid_proposals}
                />
                <center style={{ paddingTop: '1em', paddingBottom: '1em' }}>
                    {!loading ? (
                        <span
                            role="button"
                            className="btn-link"
                            onClick={this.onClickLoadMoreProposals}
                            tabIndex={0}
                        >
                            {tt('proposals.load_more')}
                        </span>
                    ) : null}

                    {showBottomLoading ? (
                        <span>{tt('proposals.loading')}</span>
                    ) : null}
                </center>
            </div>
        );
    }
}

Proposals.propTypes = {
    listProposals: PropTypes.func.isRequired,
    createProposal: PropTypes.func.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
};

module.exports = {
    path: 'proposals',
    component: connect(
        state => {
            const user = state.user.get('current');
            const currentUser = user && user.get('username');
            const proposals = state.proposal.get('proposals', List());
            const last = proposals.size - 1;
            const last_id =
                (proposals.size && proposals.get(last).get('id')) || null;
            const newProposals =
                proposals.size >= 10 ? proposals.delete(last) : proposals;

            return {
                currentUser,
                proposals: newProposals,
                last_id,
                nightmodeEnabled: state.app.getIn([
                    'user_preferences',
                    'nightmode',
                ]),
            };
        },
        dispatch => {
            return {
                voteOnProposal: (
                    voter,
                    proposal_ids,
                    approve,
                    successCallback,
                    errorCallback
                ) => {
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
                    dispatch(
                        transactionActions.broadcastOperation({
                            type: 'create_proposal',
                            operation: {
                                creator,
                                receiver,
                                start_date,
                                end_date,
                                daily_pay,
                                subject,
                                permlink,
                            },
                            successCallback,
                            errorCallback,
                        })
                    );
                },
                listProposals: payload => {
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
                setRouteTag: () =>
                    dispatch(appActions.setRouteTag({ routeTag: 'proposals' })),
            };
        }
    )(Proposals),
};
