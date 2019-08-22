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
        };
        this.id = this.props.proposal.id;
    }

    async componentWillMount() {
        // await console.log('ProposalContainer.jsx::componentWillMount()');
    }

    onUpvote = () => {
        this.setState({
            isVoting: true,
            voteFailed: false,
            voteSucceeded: false,
        });
        this.props.upvoteProposal(
            this.id,
            () => {
                // console.log('upvoteProposal->success()', arguments)
                this.setState({
                    isVoting: false,
                    voteFailed: false,
                    voteSucceeded: true,
                });
            },
            () => {
                // console.log('upvoteProposal->failure()', arguments)
                this.setState({
                    isVoting: false,
                    voteFailed: true,
                    voteSucceeded: false,
                });
            }
        );
    };

    render() {
        const { proposal } = this.props;
        // console.log('ProposalContainer.jsx::render()', this.props);

        return (
            <Proposal {...proposal} onUpvote={this.onUpvote} {...this.state} />
        );
    }
}

ProposalContainer.propTypes = {
    proposal: PropTypes.shape({ creator: PropTypes.string.isRequired })
        .isRequired,
    upvoteProposal: PropTypes.func.isRequired,
};

export default ProposalContainer;
