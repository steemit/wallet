import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { api } from '@steemit/steem-js';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';
import ConfirmDisableWitness from 'app/components/elements/ConfirmDisableWitness';

class DisableWitness extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: false,
            loadingWitnessData: false,
            error: null,
            success: null,
            isWitness: false,
            currentSigningKey: '',
            witnessUrl: '',
            accountCreationFee: '0.000 STEEM',
            maximumBlockSize: '65536',
            sbdInterestRate: '0',
        };

        this.onSubmit = this.onSubmit.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.loadWitnessData = this.loadWitnessData.bind(this);
    }

    componentDidMount() {
        this.loadWitnessData(this.props);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.accountName !== this.props.accountName) {
            this.loadWitnessData(this.props);
        }
    }

    async loadWitnessData(props = this.props) {
        const { accountName } = props;

        if (!accountName) return;

        this.setState({
            loadingWitnessData: true,
            error: null,
            success: null,
        });

        try {
            const witness = await api.getWitnessByAccountAsync(accountName);

            if (witness) {
                const propsData = witness.props || {};
                this.setState({
                    isWitness: true,
                    currentSigningKey: witness.signing_key || '',
                    witnessUrl: witness.url || '',
                    accountCreationFee: propsData.account_creation_fee || '0.000 STEEM',
                    maximumBlockSize: String(propsData.maximum_block_size || 65536),
                    sbdInterestRate: String(propsData.sbd_interest_rate || 0),
                    loadingWitnessData: false,
                });
                return;
            }

            this.setState({
                isWitness: false,
                currentSigningKey: '',
                witnessUrl: '',
                accountCreationFee: '0.000 STEEM',
                maximumBlockSize: '65536',
                sbdInterestRate: '0',
                loadingWitnessData: false,
            });
        } catch (error) {
            this.setState({
                loadingWitnessData: false,
                error: tt('steem_tools.disable_witness.error_loading_witness'),
                success: null,
            });
        }
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt('steem_tools.disable_witness.unexpected_error');
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess() {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState({
            loading: false,
            error: null,
            success: tt('steem_tools.disable_witness.success_message'),
        });
        this.loadWitnessData();
    }

    onSubmit() {
        const { currentUser, accountName, disableWitness } = this.props;
        const {
            isWitness,
            witnessUrl,
            accountCreationFee,
            maximumBlockSize,
            sbdInterestRate,
            currentSigningKey,
        } = this.state;

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.disable_witness.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.disable_witness.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.disable_witness.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (!isWitness) {
            this.setState({
                error: tt('steem_tools.disable_witness.error_not_witness'),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        disableWitness(
            {
                owner: accountName,
                url: witnessUrl || '',
                block_signing_key: 'STM1111111111111111111111111111111114T1Anm',
                props: {
                    account_creation_fee: accountCreationFee,
                    maximum_block_size: parseInt(maximumBlockSize, 10) || 65536,
                    sbd_interest_rate: parseInt(sbdInterestRate, 10) || 0,
                },
                fee: '0.000 STEEM',
                current_signing_key: currentSigningKey || '',
            },
            this.onSuccess,
            this.onFailure
        );
    }

    render() {
        const {
            currentUser,
            accountName,
        } = this.props;

        const {
            loading,
            loadingWitnessData,
            error,
            success,
            isWitness,
            currentSigningKey,
        } = this.state;

        const isOwner =
            !!currentUser &&
            !!accountName &&
            currentUser === accountName;

        const canDisable = !loading && !loadingWitnessData && isOwner && isWitness;

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.disable_witness.title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.disable_witness.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.disable_witness.witness_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '0.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        type="text"
                                        value={accountName || ''}
                                        disabled
                                        className="input-group-field bold"
                                    />
                                </div>
                                {!loadingWitnessData ? (
                                    <div className="change-recovery-account-hint" style={{ marginBottom: '1.25rem' }}>
                                        {isWitness
                                            ? tt('steem_tools.disable_witness.witness_status_yes')
                                            : tt('steem_tools.disable_witness.witness_status_no')}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {isWitness ? (
                            <div className="row row-column-mobile"  style={{ marginBottom: '1rem' }}>
                                <div
                                    className="column flex-container-1-extended flex-mobile-full"
                                    style={{ paddingTop: 5 }}
                                >
                                    <div>{tt('steem_tools.disable_witness.current_signing_key')}</div>
                                </div>
                                <div className="column flex-container-2-extended flex-mobile-full">
                                    <input
                                        className="input-group-field bold"
                                        type="text"
                                        value={currentSigningKey}
                                        disabled
                                        style={{ marginBottom: '1.25rem' }}
                                    />
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.disable_witness.error_not_allowed')}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && isOwner && !isWitness && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.disable_witness.error_not_witness')}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">{error}</div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !loadingWitnessData && success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">{success}</div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row">
                            <div className="column">
                                {loading || loadingWitnessData ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        className="button advtools-btn-primary"
                                        onClick={this.onSubmit}
                                        disabled={!canDisable}
                                    >
                                        {tt('steem_tools.disable_witness.submit_btn')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');

        const accountName =
            ownProps.accountname ||
            currentUser ||
            '';

        const account = accountName
            ? state.global.getIn(['accounts', accountName])
            : null;

        return {
            currentUser,
            accountName,
            account,
        };
    },
    dispatch => ({
        disableWitness: (
            operation,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${operation.owner}/witnesses` }));
                if (successCallback) successCallback();
            };

            const confirm = () => (
                <ConfirmDisableWitness
                    operation={{
                        owner: operation.owner,
                        current_signing_key: operation.current_signing_key,
                        new_signing_key: operation.block_signing_key,
                    }}
                />
            );

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'witness_update',
                    operation: {
                        owner: operation.owner,
                        url: operation.url,
                        block_signing_key: operation.block_signing_key,
                        props: operation.props,
                        fee: operation.fee,
                    },
                    confirm,
                    successCallback: successCb,
                    errorCallback,
                })
            );
        },
        refreshAccount: username =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(DisableWitness);
