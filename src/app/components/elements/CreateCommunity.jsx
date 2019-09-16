import React from 'react';
import { APP_NAME } from 'app/client_config';
import { connect } from 'react-redux';
import * as communityActions from 'app/redux/CommunityReducer';
import tt from 'counterpart';
import { key_utils } from '@steemit/steem-js/lib/auth/ecc';

class CreateCommunity extends React.Component {
    constructor() {
        super();
        this.state = { error: false, errorMessage: '' }; // Component error state refers to account creation ops. For errors in custom ops, see the communityHivemindOperationError prop.
    }

    render() {
        const errorCB = () => {
            this.setState({ error: true });
        };
        const successCB = () => {
            this.setState({ error: false, errorMessage: '' });
        };

        const {
            accountName,
            communityCreatePending,
            communityCreateSuccess,
            createCommunity,
            communityDescription,
            communityNSFW,
            communityOwnerWifPassword,
            communityOwnerName,
            communityTitle,
            updateCommunityTitle,
            updateCommunityDescription,
            updateCommunityNSFW,
            updateCommunityOwnerAccountName,
            updateCommunityOwnerWifPassword,
            communityHivemindOperationPending,
            communityHivemindOperationError,
            communityAccountCreated, // If the community account was successfully created, but the hivemind ops to assign the currently-logged in user as community account admin fail, the next time the user attempts to create the community, the account-creation step will be skipped.
        } = this.props;

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
            createCommunity(
                createCommunitypayload,
                successCB,
                errorCB,
                communityAccountCreated
            );
            this.setState({ error: false, errorMessage: '' });
        };

        const generateCommunityOwnerName = () => {
            return `hive-${Math.floor(Math.random() * 100000) + 100000}`;
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
                <div>{`${tt(
                    'g.community_owner_name_is'
                )}: ${communityOwnerName}`}</div>
                <div>{`${tt(
                    'g.community_password_is'
                )}: ${communityOwnerWifPassword}`}</div>
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

        const createCommunityAccountSuccessMessage = (
            <div>
                Community was successfully created on the blockchain, now
                broadcasting custom operations...
            </div>
        );

        const createCommunityCustomOpsErrorMessage = (
            <div>
                There was a problem with that operation, please try again.
            </div>
        );

        const createCommunitySuccessMessage = (
            <div>
                <p>
                    Your community was created! And your user assigned the admin
                    role!
                </p>
                <a
                    href={`https://steemitdev.com/trending/${communityOwnerName}`}
                >
                    {tt('g.community_visit')}
                </a>
            </div>
        );

        const createCommunityErrorMessage = (
            <div>
                <div>{tt('g.community_error')}</div>
                <div>{this.state.errorMessage}</div>
                <div>{tt('g.community_create_try_again')} </div>
            </div>
        );
        const createCommunityLoadingMessage = (
            <div>{tt('g.community_creating')}</div>
        );
        const createCommunityCustomOpsPendingMessage = (
            <div>{`${tt(
                'g.community_broadcasting_custom_ops'
            )} ${accountName} ${tt(
                'community_broadcasting_custom_ops_1'
            )} ${communityTitle}} ${tt(
                'community_broadcasting_custom_ops_2'
            )}`}</div>
        );

        const createCommunityForm = (
            <form onSubmit={handleCommunitySubmit}>
                <div>{tt('g.community_create')}</div>
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
                    {tt('g.community_description')}
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
                    {tt('g.community_nsfw')}
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
        );
        return (
            <div className="row">
                <div className="column large-6 small-12">
                    {communityAccountCreated &&
                        createCommunityAccountSuccessMessage}
                    {communityHivemindOperationError &&
                        createCommunityCustomOpsErrorMessage}
                    {this.state.error && createCommunityErrorMessage}
                    {this.state.error && createCommunityForm}
                    {!communityCreatePending &&
                        !communityCreateSuccess &&
                        createCommunityForm}
                    {communityCreatePending &&
                        !this.state.error &&
                        createCommunityLoadingMessage}
                    {communityHivemindOperationPending &&
                        createCommunityCustomOpsPendingMessage}
                    {communityCreateSuccess && createCommunitySuccessMessage}
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const { account } = ownProps;
        const accountName = account.get('name');
        const current = state.user.get('current');
        // get userLogin error
        console.log('userState', state.user.toJS());
        const username = current && current.get('username');
        const isMyAccount = username === accountName;
        return {
            ...ownProps,
            ...state.community.toJS(),
            isMyAccount,
            accountName,
            loginError,
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
            createCommunity: (
                createCommunityPayload,
                successCB,
                errorCB,
                skipAccountCreate
            ) => {
                const successCallback = () => {
                    successCB();
                    return dispatch(
                        communityActions.setCommunityAccountCreated(true),
                        communityActions.communityHivemindOperation(
                            createCommunityPayload
                        )
                    );
                };
                const errorCallback = () => {
                    errorCB();
                };
                const payload = {
                    successCallback: successCallback,
                    errorCallback: errorCallback,
                    ...createCommunityPayload,
                };
                if (skipAccountCreate) {
                    dispatch(communityActions.createCommunity(payload));
                } else {
                    dispatch(
                        communityActions.communityHivemindOperation(
                            createCommunityPayload
                        )
                    );
                }
            },
        };
    }
)(CreateCommunity);
