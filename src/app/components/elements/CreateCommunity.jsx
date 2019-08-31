import React, { Component } from 'react';
import { APP_NAME } from 'app/client_config';
import { connect } from 'react-redux';
import * as communityActions from 'app/redux/CommunityReducer';
import tt from 'counterpart';
import {
    PrivateKey,
    PublicKey,
    key_utils,
} from '@steemit/steem-js/lib/auth/ecc';

const CreateCommunity = ({
    accountName,
    communityCreateError,
    communityCreatePending,
    communityCreateSuccess,
    createCommunity,
    communityDescription,
    communityHivemindOperationError,
    communityHivemindOperationPending,
    communityNSFW,
    communityOwnerWifPassword,
    communityOwnerName,
    communityTitle,
    isMyAccount,
    updateCommunityTitle,
    updateCommunityDescription,
    updateCommunityNSFW,
    updateCommunityOwnerAccountName,
    updateCommunityOwnerWifPassword,
}) => {
    const handleCommunityTitleInput = e => {
        if (e.target.value.length > 32) {
            return;
        }
        updateCommunityTitle(e.target.value);
    };
    const handleCommunityDescriptionInput = e => {
        if (e.target.value.length > 120) {
            return;
        }
        updateCommunityDescription(e.target.value);
    };
    const handleCommunityNSFWInput = e => {
        updateCommunityNSFW(e.target.checked);
    };

    const handleCommunitySubmit = e => {
        e.preventDefault();
        const createCommunitypayload = {
            accountName,
            communityTitle,
            communityDescription,
            communityNSFW,
            communityOwnerName,
            communityOwnerWifPassword,
        };
        createCommunity(createCommunitypayload);
    };

    const generateCommunityOwnerName = () => {
        return `hive-${Math.floor(Math.random() * 90000) + 10000}`;
    };

    const generateCreatorWifPassword = () => {
        return 'P' + key_utils.get_random_key().toWif();
    };

    const generateWif = () => {
        const wif = generateCreatorWifPassword();
        updateCommunityOwnerWifPassword(wif);
    };

    const generateUsername = () => {
        const ownerUsername = generateCommunityOwnerName();
        updateCommunityOwnerAccountName(ownerUsername);
    };

    const generateCommunityCredentials = () => {
        generateWif();
        generateUsername();
    };

    const generateCommunityCredentialsButton = (
        <button
            type="button"
            className="button hollow"
            onClick={generateCommunityCredentials}
        >
            {tt('g.click_to_generate_password')}
        </button>
    );

    const rememberCredentialsPrompt = (
        <div>
            <div>{`Your community owner name is: ${communityOwnerName}`}</div>
            <div>{`Your password is: ${communityOwnerWifPassword}`}</div>
        </div>
    );

    const rememberCredentialsCheckbox1 = (
        <label htmlFor="box1">
            <input type="checkbox" name="box1" required />
            {tt('g.understand_that_APP_NAME_cannot_recover_password', {
                APP_NAME,
            })}.
        </label>
    );

    const rememberCredentialsCheckbox2 = (
        <label htmlFor="box2">
            <input type="checkbox" name="box2" required />
            {tt('g.i_saved_password')}.
        </label>
    );

    const submitCreateCommunityFormButton = (
        <input type="submit" value="Submit" />
    );

    return (
        <div className="row">
            <div className="column large-6 small-12">
                <form onSubmit={handleCommunitySubmit}>
                    <div>CREATE A COMMUNITY</div>
                    <label htmlFor="community_title">
                        Title
                        <input
                            id="community_title"
                            name="community_title"
                            type="text"
                            minLength="4"
                            maxLength="30"
                            onChange={handleCommunityTitleInput}
                            value={communityTitle}
                            required
                        />
                    </label>
                    <label htmlFor="community_description">
                        Description
                        <input
                            id="community_description"
                            name="community_description"
                            type="text"
                            minLength="10"
                            maxLength="140"
                            onChange={handleCommunityDescriptionInput}
                            value={communityDescription}
                            required
                        />
                    </label>
                    <label id="is_nsfw" htmlFor="is_nsfw">
                        Is NSFW.
                        <input
                            type="checkbox"
                            name="is_nsfw"
                            checked={communityNSFW}
                            onChange={handleCommunityNSFWInput}
                        />
                    </label>
                    {communityOwnerWifPassword.length <= 0 &&
                        generateCommunityCredentialsButton}
                    {communityOwnerWifPassword.length > 0 &&
                        rememberCredentialsPrompt}
                    {communityOwnerWifPassword.length > 0 &&
                        rememberCredentialsCheckbox1}
                    {communityOwnerWifPassword.length > 0 &&
                        rememberCredentialsCheckbox2}
                    {communityOwnerWifPassword.length > 0 &&
                        submitCreateCommunityFormButton}
                </form>
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
            updateCommunityOwnerAccountName: accountName => {
                dispatch(
                    communityActions.setCommunityOwnerAccountName(accountName)
                );
            },
            updateCommunityOwnerWifPassword: password => {
                dispatch(
                    communityActions.setCommunityOwnerWifPassword(password)
                );
            },
            createCommunity: createCommunityPayload => {
                dispatch(
                    communityActions.createCommunity(createCommunityPayload)
                );
            },
        };
    }
)(CreateCommunity);
