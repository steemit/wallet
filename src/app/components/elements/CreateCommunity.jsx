import React from 'react';
import { APP_NAME } from 'app/client_config';
import { connect } from 'react-redux';
import * as communityActions from 'app/redux/CommunityReducer';
import tt from 'counterpart';
import { key_utils } from '@steemit/steem-js/lib/auth/ecc';

class CreateCommunity extends React.Component {
    constructor() {
        super();
        this.state = {
            accountError: false,
            broadcastOpsError: false,
            accountCreated: false,
        };
    }
    componentDidMount() {}
    render() {
        const {
            accountName,
            communityCreateError,
            communityCreatePending,
            communityCreateSuccess,
            createCommunity,
            communityDescription,
            communityOwnerWifPassword,
            communityOwnerName,
            communityTitle,
            updateCommunityTitle,
            updateCommunityDescription,
            updateCommunityOwnerAccountName,
            updateCommunityOwnerWifPassword,
            broadcastOps,
        } = this.props;

        const handleAccountCreateError = () => {
            this.setState({ accountError: true });
        };

        const handleAccountCreateSuccess = () => {
            this.setState({ accountCreated: true });
        };

        const handleBroadcastOpsError = () => {
            this.setState({ broadcastOpsError: false });
        };

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

        const handleCommunitySubmit = e => {
            e.preventDefault();
            const createCommunityPayload = {
                accountName,
                communityTitle,
                communityDescription,
                communityOwnerName,
                communityOwnerWifPassword,
                createAccountSuccessCB: handleAccountCreateSuccess,
                createAccountErrorCB: handleAccountCreateError,
                broadcastOpsErrorCB: handleBroadcastOpsError,
            };
            if (!this.state.accountCreated) {
                createCommunity(createCommunityPayload);
            } else {
                broadcastOps(createCommunityPayload);
            }
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
                className="button hollow community__button"
                onClick={generateCommunityCredentials}
            >
                {tt('g.click_to_generate_password')}
            </button>
        );

        const rememberCredentialsPrompt = (
            <div>
                <div className="community-credentials community-credentials__name">
                    {`${tt('g.community_owner_name_is')}:`}
                    <br />
                    <code className="community-credentials__owner-name">
                        {communityOwnerName}
                    </code>
                </div>
                <div className="community-credentials community-credentials__password">
                    {`${tt('g.community_password_is')}:`}
                    <br />
                    <code className="community-credentials__owner-password">
                        {communityOwnerWifPassword}
                    </code>
                </div>
            </div>
        );

        const rememberCredentialsCheckbox1 = (
            <label htmlFor="box1" className="community-credentials">
                <input type="checkbox" name="box1" required />
                {tt('g.understand_that_APP_NAME_cannot_recover_password', {
                    APP_NAME,
                })}.
            </label>
        );

        const rememberCredentialsCheckbox2 = (
            <label htmlFor="box2" className="community-credentials">
                <input type="checkbox" name="box2" required />
                {tt('g.i_saved_password')}.
            </label>
        );

        const submitCreateCommunityFormButton = (
            <input
                className="button hollow community__button"
                type="submit"
                value="Submit"
            />
        );

        const createCommunityAccountSuccessMessage = (
            <div className="community-message community-message--progress">
                Community account created on the blockchain. Setting current
                user to be community admin...
            </div>
        );

        const createCommunityAccountErrorMessage = (
            <div className="community-message community-message--error">
                Unable to create that community. Please ensure you used the
                correct key.
            </div>
        );

        const createCommunityBroadcastOpsErrorMessage = (
            <div className="community-message community-message--error">
                The community was created but setting current user to be admin
                failed. Wait a moment and try again
            </div>
        );

        const createCommunitySuccessMessage = (
            <div className="community-message community-message--success">
                <p>Your community was created!</p>
                <a
                    href={`https://steemitdev.com/trending/${communityOwnerName}`}
                >
                    {tt('g.community_visit')}
                </a>
            </div>
        );
        const createCommunityErrorMessage = (
            <div className="community-message community-message--error">
                {tt('g.community_error')}
            </div>
        );

        const createCommunityLoading = (
            <div className="community-message community-message--progress">
                {tt('g.community_creating')}
            </div>
        );

        const createCommunityForm = (
            <form onSubmit={handleCommunitySubmit}>
                <label htmlFor="community_title" className="community__label">
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
                <label
                    htmlFor="community_description"
                    className="community__label"
                >
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
                    <div>{tt('g.community_create')}</div>
                    {this.state.accountError &&
                        createCommunityAccountErrorMessage}
                    {this.state.accountCreated &&
                        !communityCreateSuccess &&
                        createCommunityAccountSuccessMessage}
                    {this.state.broadcastOpsError &&
                        createCommunityBroadcastOpsErrorMessage}
                    {this.state.accountError && createCommunityForm}
                    {this.state.broadcastOpsError && createCommunityForm}
                    {!communityCreatePending &&
                        !communityCreateSuccess &&
                        createCommunityForm}
                    {communityCreatePending &&
                        !this.state.accountError &&
                        !this.state.broadcastOpsError &&
                        createCommunityLoading}
                    {communityCreateSuccess && createCommunitySuccessMessage}
                    {communityCreateError && createCommunityErrorMessage}
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
                const successCallback = () =>
                    dispatch(
                        communityActions.communityHivemindOperation(
                            createCommunityPayload
                        )
                    );
                const payload = {
                    broadcastOpsCb: successCallback,
                    ...createCommunityPayload,
                };
                dispatch(communityActions.createCommunity(payload));
            },
            broadcastOps: createCommunityPayload => {
                dispatch(
                    communityActions.communityHivemindOperation(
                        createCommunityPayload
                    )
                );
            },
        };
    }
)(CreateCommunity);
