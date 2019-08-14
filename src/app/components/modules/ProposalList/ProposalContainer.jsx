import React from 'react';
import PropTypes from 'prop-types';

import Proposal from './Proposal';

class ProposalContainer extends React.Component {
    constructor(props) {
        console.log('ProposalContainer.jsx::constructor()', props);
        super(props);
        this.state = {};
        this.id = this.props.proposal.id;
    }

    async componentWillMount() {
        await console.log('ProposalContainer.jsx::componentWillMount()');
    }

    onUpvote = () => {
        this.setState(('isVoting': true));
        this.props.upvoteProposal(this.id);
    };

    render() {
        const { proposal } = this.props;
        console.log('ProposalContainer.jsx::render()', this.props);

        return (
            <Proposal
                {...proposal}
                onUpvote={this.onUpvote}
                isVoting={this.state.isVoting}
            />
        );
    }
}

ProposalContainer.propTypes = {
    proposal: PropTypes.shape({ creator: PropTypes.string.isRequired })
        .isRequired,
    upvoteProposal: PropTypes.func.isRequired,
};

export default ProposalContainer;
