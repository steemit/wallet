import CloseButton from 'app/components/elements/CloseButton';
import Reveal from 'app/components/elements/Reveal';
import { NotificationStack } from 'react-notification';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import ConfirmChangeRecoveryAccount from 'app/components/elements/ConfirmChangeRecoveryAccount';
import React, { Component } from 'react';
import reactForm from 'app/utils/ReactForm';
import tt from 'counterpart';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { FormattedHTMLMessage } from 'app/Translator';
import { connect } from 'react-redux';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';

class ChangeRecoveryAccount extends Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Modals');
        this.state = {
            loading: false,
        };
        this.initForm(props);
    }

    initForm(props) {
        const fields = ['new_account'];
        reactForm({
            name: 'changeRecoveryAccount',
            instance: this,
            fields,
            initialValues: { new_account: '' },
            validation: values => {
                return {
                    new_account: !values.new_account
                        ? tt('g.required')
                        : null,
                };
            },
        });
    }

    onFailure = () => {
        this.setState({ loading: false });
    };

    onSubmit = ({ current_recovery_account, pending_recovery_account, new_account, onSuccess, onFailure }) => {
        const { currentUser, refreshAccount } = this.props;
        this.props.changeRecoveryAccount(
            currentUser,
            current_recovery_account,
            pending_recovery_account,
            new_account,
            () => {
                refreshAccount(currentUser);
                if (onSuccess) onSuccess();
            },
            () => {
                if (onFailure) onFailure();
            }
        );
    };

    render() {
        const { new_account } = this.state;
        const { loading } = this.state;
        const {
            showChangeRecoveryModal,
            hideChangeRecoveryModal,
            notifications,
            removeNotification,
            account
        } = this.props;
        let accountToRecover, recoveryAccount, pendingRecoveryAccount;
        if (account) {
            const recoveryInfo = account.get('account_recovery');
            if (recoveryInfo) {
                accountToRecover = recoveryInfo.get('account_to_recover');
                recoveryAccount = account.get('recovery_account');
                pendingRecoveryAccount = recoveryInfo.get('recovery_account');
            }
        }

        const { submitting, valid, handleSubmit } = this.state.changeRecoveryAccount;
        const notifications_array = notifications
            ? notifications.toArray().map(n => {
                  n.onClick = () => removeNotification(n.key);
                  return n;
              })
            : [];

        const form = (
            <form
                onSubmit={handleSubmit(({ data }) => {
                    this.setState({ loading: true });
                    this.onSubmit({
                        ...data,
                        current_recovery_account: recoveryAccount,
                        pending_recovery_account: pendingRecoveryAccount,
                        onSuccess: hideChangeRecoveryModal,
                        onFailure: this.onFailure,
                    });
                })}
            >
                <div>
                    <div className="row">
                        <div className="column small-12">
                            <div className="FormattedHTMLMessage secondary">
                                <FormattedHTMLMessage id="change_recovery_account.faq_link_message" />
                            </div>
                        </div>
                    </div>
                    <br />
                </div>
                <div className="row">
                    <div className="column small-4" style={{ paddingTop: 5 }}>
                        {tt('change_recovery_account.current_account')}
                    </div>
                    <div className="column small-8" style={{ marginBottom: '1.25rem' }}>
                        <input
                            type="text"
                            value={accountToRecover}
                            disabled
                            className="input-group-field"
                        />
                    </div>
                </div>
                <div className="row">
                    <div className="column small-4" style={{ paddingTop: 5 }}>
                        {tt('change_recovery_account.current_recovery_account')}
                    </div>
                    <div className="column small-8" style={{ marginBottom: '1.25rem' }}>
                        <input
                            type="text"
                            value={recoveryAccount}
                            disabled
                            className="input-group-field"
                        />
                    </div>
                </div>
                <div className="row">
                    <div className="column small-4" style={{ paddingTop: 5 }}>
                        {tt('change_recovery_account.pending_recovery_account')}
                    </div>
                    <div className="column small-8" style={{ marginBottom: '1.25rem' }}>
                        <input
                            type="text"
                            value={pendingRecoveryAccount}
                            disabled
                            className="input-group-field"
                        />
                    </div>
                </div>

                <div className="row">
                    <div className="column small-4" style={{ paddingTop: 5 }}>
                        {tt('change_recovery_account.new_account')}
                    </div>
                    <div className="column small-8" style={{ marginBottom: '1.25rem' }}>
                        <input
                            type="text"
                            {...new_account.props}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck="false"
                            disabled={loading}
                        />
                    </div>
                </div>

                <div className="row" style={{ marginTop: '1.25rem' }}>
                    <div className="column">
                        {loading ? (
                            <span>
                                <LoadingIndicator type="circle" />
                            </span>
                        ) : (
                            <button
                                type="submit"
                                className="button"
                                disabled={submitting || !valid}
                            >
                                {tt('g.next')}
                            </button>
                        )}
                    </div>
                </div>
            </form>
        );

        return (
            <div>
                {showChangeRecoveryModal && (
                    <Reveal
                        onHide={hideChangeRecoveryModal}
                        show={showChangeRecoveryModal}
                    >
                        <CloseButton onClick={hideChangeRecoveryModal} />
                        <div className="row">
                            <h3 className="column">
                                {tt('change_recovery_account.title')}
                            </h3>
                        </div>
                        {form}
                    </Reveal>
                )}
                <NotificationStack
                    notifications={notifications_array}
                    onDismiss={n => removeNotification(n.key)}
                />
            </div>
        );
    }
}

export default connect(
    state => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');
        return {
            currentUser,
            notifications: state.app.get('notifications'),
            account: state.global.getIn(['accounts', currentUser]),
        };
    },
    dispatch => ({
        changeRecoveryAccount: (account, current_recovery_account, pending_recovery_account, new_account, successCallback, errorCallback) => {
            const successCb = () => {
                dispatch(
                    globalActions.getState({ url: `@${account}/transfers` })
                );
                if (successCallback) successCallback();
            };
            const operation = {
                account_to_recover: account,
                new_recovery_account: new_account,
                extensions: [],
            };
            const confirm = () => (
                <ConfirmChangeRecoveryAccount operation={{
                    current_account: account,
                    current_recovery_account,
                    pending_recovery_account,
                    new_recovery_account: new_account,

                }} />
            );
            dispatch(
                transactionActions.broadcastOperation({
                    type: 'change_recovery_account',
                    operation,
                    successCallback: successCb,
                    errorCallback,
                    confirm,
                })
            );
        },
        refreshAccount: (username) =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(ChangeRecoveryAccount);
