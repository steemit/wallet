import React, { Component } from 'react';
import PropTypes from 'prop-types';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { connect } from 'react-redux';
import * as communityActions from 'app/redux/CommunityReducer';

const CreateCommunity = ({
    accountName,
    communityCreateError,
    communityCreatePending,
    communityDescription,
    communityHivemindOperationError,
    communityHivemindOperationPending,
    communityNSFW,
    communityOwnerMasterPassword,
    communityOwnerName,
    communityTitle,
    isMyAccount,
    updateCommunityTitle,
    updateCommunityDescription,
    updateCommunityNSFW,
}) => {
    debugger;
    const handleCommunityTitleInput = e => {};
    return (
        <div className="row">
            <div className="column large-6 small-12">
                <div>CREATE A COMMUNITY</div>
                <label htmlFor="community_title">Title</label>
                <input
                    id="community_title"
                    name="community_title"
                    minLength="4"
                    maxLength="30"
                    onChange={handleCommunityTitleInput}
                />
                <label htmlFor="community_description">Description</label>
                <input
                    id="community_description"
                    name="community_description"
                    minLength="10"
                    maxLength="140"
                    onChange={handleCommunityDescriptionInput}
                    required
                />
                <label id="is_nsfw" htmlFor="is_nsfw">
                    Is NSFW.
                </label>
                <input
                    type="checkbox"
                    name="is_nsfw"
                    onChange={handleCommunityNSFWInput}
                />
            </div>
        </div>
    );
};

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const { account } = ownProps;
        const accountName = account.get('name');
        const current = state.user.get('current');
        const username = current && current.get('username');
        const isMyAccount = username === accountName;
        return {
            ...ownProps,
            ...state.community.toJS(),
            isMyAccount,
            accountName,
        };
    },
    // mapDispatchToProps
    dispatch => {
        return {
            updateCommunityTitle: title => {
                dispatch(communityActions.setCommunityTitle(title));
            },
            updateCommunityDescription: description => {
                dispatch(communityActions.setCommunityDescription(description));
            },
            updateCommunityNSFW: isNSFW => {
                dispatch(communityActions.setCommunityNSFW(isNSFW));
            },
        };
    }
)(CreateCommunity);
