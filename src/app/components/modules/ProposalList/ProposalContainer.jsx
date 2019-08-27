import React from 'react';
import PropTypes from 'prop-types';

import Proposal from './Proposal';

class ProposalContainer extends React.Component {
    constructor(props) {
        // console.log('ProposalContainer.jsx::constructor()', props);
        super(props);
        this.state = {
            isVoting: false,
            voteFailed: false,
            voteSucceeded: false,
            isUpVoted: props.proposal.isUpVoted,
        };
        this.id = this.props.proposal.id;
    }

    async componentWillMount() {
        // await console.log('ProposalContainer.jsx::componentWillMount()');
    }

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
        const { proposal } = this.props;
        // console.log('ProposalContainer.jsx::render()', this.props);

        return <Proposal {...proposal} onVote={this.onVote} {...this.state} />;
    }
}

ProposalContainer.propTypes = {
    proposal: PropTypes.shape({ creator: PropTypes.string.isRequired })
        .isRequired,
    voteOnProposal: PropTypes.func.isRequired,
};

export default ProposalContainer;
