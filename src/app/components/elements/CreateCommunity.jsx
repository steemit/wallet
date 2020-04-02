import React from 'react';
import { APP_NAME } from 'app/client_config';
import { connect } from 'react-redux';
import * as communityActions from 'app/redux/CommunityReducer';
import tt from 'counterpart';
import { key_utils } from '@steemit/steem-js/lib/auth/ecc';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import Unicode from 'app/utils/Unicode';

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
            communityCreationPending,
            socialUrl,
        } = this.props;

        const handleAccountCreateError = error => {
            // If the user cancels the account creation do not show an error.
            if (error === undefined || error === 'Canceled') {
                communityCreationPending(false);
                return;
            }
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

        const generateCreds = () => {
            generateWif();
            generateUsername();
        };

        const generateCommunityCredentialsButton = (
            <button type="button" className="button" onClick={generateCreds}>
                Next
            </button>
        );

        const credentialsPane = (
            <div>
                <label>
                    Owner Name / Password
                    <code className="pwd">
                        {communityOwnerName}
                        <br />
                        {communityOwnerWifPassword}
                    </code>
                </label>
                <label style={{ marginTop: '0px' }}>
                    <input type="checkbox" name="box2" required />
                    I have securely saved my owner name and password.
                </label>
            </div>
        );

        const submitCreateCommunityFormButton = error => (
            <input
                className="button"
                type="submit"
                value="Create Community"
                disabled={!!error}
            />
        );

        const hasPass = communityOwnerWifPassword.length > 0;

        let formError = null;
        const rx = new RegExp('^[' + Unicode.L + ']');
        if (!rx.test(communityTitle) && (communityTitle || hasPass))
            formError = 'Must start with a letter.';

        const form = (
            <form className="community--form" onSubmit={handleCommunitySubmit}>
                <div>{tt('g.community_create')}</div>
                <label>
                    Title
                    <input
                        id="community_title"
                        type="text"
                        minLength="3"
                        maxLength="20"
                        onChange={handleCommunityTitleInput}
                        value={communityTitle}
                        required
                    />
                </label>
                {formError && <span className="error">{formError}</span>}
                <label>
                    {tt('g.community_description')}
                    <input
                        id="community_description"
                        type="text"
                        maxLength="120"
                        onChange={handleCommunityDescriptionInput}
                        value={communityDescription}
                    />
                </label>
                {!hasPass && generateCommunityCredentialsButton}
                {hasPass && credentialsPane}
                {hasPass && submitCreateCommunityFormButton(formError)}
            </form>
        );

        const accountCreated = this.state.accountCreated;
        const accountError = this.state.accountError;
        const settingsError = this.state.broadcastOpsError;
        const errored = accountError || settingsError;
        const pending = communityCreatePending && !errored;
        const finished = communityCreateSuccess;
        const sagaError = communityCreateError;

        if (finished) {
            const url = `${socialUrl}/trending/${communityOwnerName}`;
            return (
                <div className="row">
                    <div className="column large-6 small-12">
                        Your community was created!<br />
                        <strong>
                            <a href={url}>Get started.</a>
                        </strong>
                    </div>
                </div>
            );
        }

        const showErr = msg => <div className="community--error">{msg}</div>;
        const adminMsg = `Account created. Setting @${accountName} as admin...`;

        return (
            <div className="row">
                <div className="column large-6 small-12">
                    {accountError && showErr('Account creation failed.')}
                    {settingsError && showErr('Update settings failed.')}
                    {sagaError && showErr('Failed. Please report this issue.')}
                    {accountCreated && <div>{adminMsg}</div>}
                    {pending ? <LoadingIndicator type="circle" /> : form}
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
        const socialUrl = state.app.get('socialUrl');
        return {
            ...ownProps,
            ...state.community.toJS(),
            isMyAccount,
            accountName,
            socialUrl,
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
            communityCreationPending: createCommunityAccountPending => {
                dispatch(
                    communityActions.createCommunityAccountPending(
                        createCommunityAccountPending
                    )
                );
            },
        };
    }
)(CreateCommunity);
