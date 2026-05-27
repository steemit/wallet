/* eslint-disable jsx-a11y/label-has-associated-control */
import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { numberWithCommas } from 'app/utils/StateFunctions';
import { REFUND_ACCOUNTS } from 'app/client_config';
import { api } from '@steemit/steem-js';
import ProposalContainer from './ProposalContainer';
import ProposalsHeader from './ProposalsHeader';

class ProposalList extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            daoTreasury: null,
            dailyBudget: null,
            filteredProposals: props.proposals,
            searchTerm: '',
        };
        this.handleSearchChange = this.handleSearchChange.bind(this);
    }

    componentDidMount() {
        this.fetchConfig();
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevProps.proposals !== this.props.proposals) {
            this.resetProposals();
        }
        if (
            prevState.dailyBudget !== this.state.dailyBudget &&
            this.state.dailyBudget !== null &&
            typeof this.state.dailyBudget === 'string' &&
            /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(this.state.dailyBudget)
        ) {
            this.fetchProposals();
        }
    }

    resetProposals() {
        this.setState({
            filteredProposals: this.props.proposals,
            searchTerm: '',
        });
    }

    handleSearchChange(event) {
        const searchTerm = event.target.value;
        const lowerSearch = searchTerm.toLowerCase();
        const filtered = this.props.proposals.filter(proposal => {
            const { subject, receiver, permlink, creator } = proposal;
            return (
                (subject && subject.toLowerCase().includes(lowerSearch)) ||
                (receiver && receiver.toLowerCase().includes(lowerSearch)) ||
                (permlink && permlink.toLowerCase().includes(lowerSearch)) ||
                (creator && creator.toLowerCase().includes(lowerSearch))
            );
        });
        this.setState({
            searchTerm,
            filteredProposals:
                searchTerm === '' ? this.props.proposals : filtered,
        });
    }

    fetchConfig() {
        if (REFUND_ACCOUNTS.length > 0) {
            api.getAccountsAsync(REFUND_ACCOUNTS)
                .then(res => {
                    if (res && res.length > 0 && res[0].sbd_balance) {
                        const rawBalance = res[0].sbd_balance;
                        const numericPart = rawBalance.split(' ')[0];
                        this.setState({
                            daoTreasury: numberWithCommas(numericPart),
                            dailyBudget: numberWithCommas(
                                `${(parseFloat(numericPart) / 100).toFixed(3)}`
                            ),
                        });
                    }
                })
                .catch(err => console.log(err));
        }
    }

    fetchProposals() {
        api.listProposalsAsync(
            [-1, 0],
            1000,
            'by_total_votes',
            'descending',
            'active'
        )
            .then(proposals => {
                try {
                    if (!Array.isArray(proposals)) {
                        console.log(
                            'DEBUG_LOG: Error - Proposals is not an array',
                            proposals
                        ); // DEBUG_LOG
                        return;
                    }
                    const { dailyBudget } = this.state;
                    let budget = parseFloat(dailyBudget.replace(/,/g, ''));
                    const selectedProposalIds = [];
                    for (let i = 0; i < proposals.length; i++) {
                        const proposal = proposals[i];
                        const payStr = proposal.daily_pay
                            .replace(' SBD', '')
                            .replace(/,/g, '');
                        const pay = parseFloat(payStr);
                        if (proposal.daily_pay) {
                            if (budget - pay >= 0) {
                                budget -= pay;
                                selectedProposalIds.push(proposal.id);
                            } else if (budget > 0 && budget - pay < 0) {
                                budget -= pay;
                                selectedProposalIds.push(proposal.id);
                                break;
                            } else {
                                break;
                            }
                        }
                    }
                    this.props.setPaidProposals(selectedProposalIds);
                } catch (error) {
                    console.error('DEBUG_LOG: Error in proposals:', error); // DEBUG_LOG
                }
            })
            .catch(err => {
                console.error('DEBUG_LOG: Error fetching proposals:', err); // DEBUG_LOG
            });
    }

    render() {
        const {
            proposals,
            voteOnProposal,
            loading,
            onFilter,
            onOrder,
            onOrderDirection,
            status,
            orderBy,
            orderDirection,
            triggerVotersModal,
            triggerCreatorsModal,
            getNewId,
        } = this.props;

        const {
            daoTreasury,
            dailyBudget,
            filteredProposals,
            searchTerm,
        } = this.state;
        const proposalCount = proposals.length;

        return (
            <div className="ProposalsList column">
                <ProposalsHeader
                    status={status}
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    onFilter={onFilter}
                    onOrder={onOrder}
                    onOrderDirection={onOrderDirection}
                    triggerCreatorsModal={triggerCreatorsModal}
                    daoTreasury={daoTreasury}
                    dailyBudget={dailyBudget}
                />

                {loading && proposalCount === 0 ? (
                    <center>
                        <h5>
                            {tt('proposals.empty_state.loading_title')}
                            <br />
                            <small>
                                {tt('proposals.empty_state.loading_subtitle')}
                            </small>
                        </h5>
                    </center>
                ) : !loading && proposalCount === 0 ? (
                    <center>
                        <h5>
                            {tt('proposals.empty_state.no_results_title')}
                            <br />
                            <small>
                                {tt(
                                    'proposals.empty_state.no_results_subtitle'
                                )}
                            </small>
                        </h5>
                    </center>
                ) : null}

                {loading &&
                    proposalCount > 0 && (
                        <center>
                            <span>
                                <LoadingIndicator type="circle" />
                            </span>
                            <h5>
                                {tt('g.loading')}
                                <br />
                                <small>
                                    {tt('proposals.wait_for_proposal_load')}
                                </small>
                            </h5>
                        </center>
                    )}

                {!loading && (
                    <div>
                        <div className="search_proposal">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={this.handleSearchChange}
                            />
                        </div>
                        {filteredProposals.length > 0 &&
                            filteredProposals.map(proposal => (
                                <ProposalContainer
                                    key={proposal.id}
                                    getNewId={getNewId}
                                    triggerModal={triggerVotersModal}
                                    voteOnProposal={voteOnProposal}
                                    proposal={proposal}
                                    currentUser={this.props.currentUser}
                                    walletSectionAccount={this.props.walletSectionAccount}
                                    removeProposalById={
                                        this.props.removeProposalById
                                    }
                                    paid_proposals={this.props.paid_proposals}
                                />
                            ))}
                    </div>
                )}
            </div>
        );
    }
}

export default ProposalList;

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
    onFilter: PropTypes.func.isRequired,
    onOrder: PropTypes.func.isRequired,
    onOrderDirection: PropTypes.func.isRequired,
    onToggleFilters: PropTypes.func.isRequired,
    showFilters: PropTypes.bool.isRequired,
    status: PropTypes.oneOf(['all', 'active', 'inactive', 'expired', 'votable'])
        .isRequired,
    orderBy: PropTypes.oneOf([
        'by_creator',
        'by_start_date',
        'by_end_date',
        'by_total_votes',
    ]).isRequired,
    orderDirection: PropTypes.oneOf(['ascending', 'descending']).isRequired,
};
