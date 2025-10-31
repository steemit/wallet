import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Proposal from './Proposal';

class ProposalContainer extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isVoting: false,
            voteFailed: false,
            voteSucceeded: false,
            isUpVoted: props.proposal.upVoted,
            // needed from global state object to calculate vests to sp
            total_vesting_shares: props.total_vesting_shares,
            total_vesting_fund_steem: props.total_vesting_fund_steem,
            triggerModal: props.triggerModal,
        };
        this.id = this.props.proposal.id;
    }

    async componentWillMount() {
        // await console.log('ProposalContainer.jsx::componentWillMount()');
    }

    componentDidUpdate(prevProps) {
        if (prevProps.proposal.upVoted !== this.props.proposal.upVoted) {
            this.updateIsUpVotedFromProps();
        }
    }

    updateIsUpVotedFromProps = () => {
        this.setState({ isUpVoted: this.props.proposal.upVoted });
    };

    onVote = () => {
        this.setState({
            isVoting: true,
            voteFailed: false,
            voteSucceeded: false,
        });
        const voteForIt = !this.state.isUpVoted;
        console.log(
            'const voteForIt = !this.props.proposal.upVoted;',
            voteForIt
        );
        this.props.voteOnProposal(
            this.id,
            voteForIt,
            () => {
                console.log('voteOnProposal->success()');
                this.setState({
                    isVoting: false,
                    voteFailed: false,
                    voteSucceeded: true,
                    isUpVoted: voteForIt,
                });
                console.log('voteOnProposal->voteForIt', voteForIt);
            },
            () => {
                console.log('voteOnProposal->failure()');
                this.setState({
                    isVoting: false,
                    voteFailed: true,
                    voteSucceeded: false,
                    isUpVoted: !voteForIt,
                });
                console.log('voteOnProposal->voteForIt', voteForIt);
            }
        );
    };

    render() {
        const {
            proposal,
            total_vesting_shares,
            total_vesting_fund_steem,
            getNewId,
        } = this.props;

        return (
            <Proposal
                getNewId={getNewId}
                triggerModal={this.state.triggerModal}
                {...proposal}
                onVote={this.onVote}
                {...this.state}
                total_vesting_shares={total_vesting_shares}
                total_vesting_fund_steem={total_vesting_fund_steem}
                currentUser={this.props.currentUser}
                walletSectionAccount={this.props.walletSectionAccount}
                isUpVoted={this.state.isUpVoted}
                removeProposalById={this.props.removeProposalById}
                paid_proposals={this.props.paid_proposals}
            />
        );
    }
}

ProposalContainer.propTypes = {
    proposal: PropTypes.shape({ creator: PropTypes.string.isRequired })
        .isRequired, // TODO: Add Shape
    voteOnProposal: PropTypes.func.isRequired,
};

export default connect((state, ownProps) => {
    // pulling these out of state object to calculate vests to sp
    const total_vesting_shares = state.global.getIn([
        'props',
        'total_vesting_shares',
    ]);
    const total_vesting_fund_steem = state.global.getIn([
        'props',
        'total_vesting_fund_steem',
    ]);
    return { total_vesting_shares, total_vesting_fund_steem, ...ownProps };
})(ProposalContainer);
