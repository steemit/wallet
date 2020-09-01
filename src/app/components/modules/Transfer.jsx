import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import reactForm from 'app/utils/ReactForm';
import { Map, List, OrderedSet } from 'immutable';
import Autocomplete from 'react-autocomplete';
import tt from 'counterpart';

import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import ConfirmTransfer from 'app/components/elements/ConfirmTransfer';
import runTests, { browserTests } from 'app/utils/BrowserTests';
import {
    validate_account_name_with_memo,
    validate_memo_field,
    validate_account_name,
} from 'app/utils/ChainValidation';
import { countDecimals } from 'app/utils/ParsersAndFormatters';
import { APP_NAME, LIQUID_TOKEN, VESTING_TOKEN } from 'app/client_config';

/** Warning .. This is used for Power UP too. */
class TransferForm extends Component {
    static propTypes = {
        // redux
        currentUser: PropTypes.object.isRequired,
        toVesting: PropTypes.bool.isRequired,
        currentAccount: PropTypes.object.isRequired,
        following: PropTypes.object.isRequired,
    };

    static defaultProps = {
        following: OrderedSet([]),
    };

    constructor(props) {
        super();
        const { transferToSelf } = props;
        this.state = {
            advanced: !transferToSelf,
            transferTo: false,
            autocompleteUsers: [],
            switchTron: false,
            switchSteem: true,
            tron_transfer: false,
            tron_transfer_msg: '',
            hide_tron_address: '',
            error: false,
            to_tron_address: '',
        };
        this.initForm(props);
    }

    // covert tron address into the one only showing first and last 6 digit
    covertTronAddress(tron_address) {
        let fix_address = tron_address;
        let middle_string = '';
        fix_address =
            fix_address.substring(0, 6) +
            middle_string.padStart(fix_address.length - 12, '*') +
            fix_address.slice(-6);
        return fix_address;
    }
    componentDidMount() {
        setTimeout(() => {
            const { advanced } = this.state;
            if (advanced) this.to.focus();
            else ReactDOM.findDOMNode(this.refs.amount).focus();
        }, 300);

        runTests();

        if (this.props.initialValues.transferType == 'tron_transfer') {
            this.setState({ tron_transfer: true });
            if (
                this.props.tron_address != '' &&
                this.props.tron_address.length > 12
            ) {
                this.setState({
                    tron_address: this.covertTronAddress(
                        this.props.tron_address
                    ),
                });
            }
        }
        this.buildTransferAutocomplete();
    }

    buildTransferAutocomplete() {
        // Get names for the recent account transfers
        const labelPreviousTransfers = tt(
            'transfer_jsx.autocomplete_previous_transfers'
        );
        const labelFollowingUser = tt(
            'transfer_jsx.autocomplete_user_following'
        );

        const transferToLog = this.props.currentAccount
            .get('transfer_history', List())
            .reduce((acc, cur) => {
                if (cur.getIn([1, 'op', 0]) === 'transfer') {
                    const username = cur.getIn([1, 'op', 1, 'to']);
                    const numTransfers = acc.get(username)
                        ? acc.get(username).numTransfers + 1
                        : 1;
                    return acc.set(username, {
                        username,
                        label: `${numTransfers} ${labelPreviousTransfers}`,
                        numTransfers,
                    });
                }
                return acc;
            }, Map())
            .remove(this.props.currentUser.get('username'));

        // Build a combined list of users you follow & have previously transferred to,
        // and sort it by 1. desc the number of previous transfers 2. username asc.
        this.setState({
            autocompleteUsers: this.props.following
                .toOrderedMap()
                .map(username => ({
                    username,
                    label: labelFollowingUser,
                    numTransfers: 0,
                }))
                .merge(transferToLog)
                .sortBy(null, (a, b) => {
                    //prioritize sorting by number of transfers
                    if (a.numTransfers > b.numTransfers) {
                        return -1;
                    }
                    if (b.numTransfers > a.numTransfers) {
                        return 1;
                    }
                    //if transfer number is the same, sort by username
                    if (a.username > b.username) {
                        return 1;
                    }
                    if (b.username > a.username) {
                        return -1;
                    }
                    return 0;
                })
                .toArray(),
        });
    }

    matchAutocompleteUser(item, value) {
        return item.username.toLowerCase().indexOf(value.toLowerCase()) > -1;
    }

    onAdvanced = e => {
        e.preventDefault(); // prevent form submission!!
        const username = this.props.currentUser.get('username');
        this.state.to.props.onChange(username);
        // setTimeout(() => {ReactDOM.findDOMNode(this.refs.amount).focus()}, 300)
        this.setState({ advanced: !this.state.advanced });
    };

    initForm(props) {
        const { transferType } = props.initialValues;
        const insufficientFunds = (asset, amount) => {
            const { currentAccount } = props;
            const isWithdraw =
                transferType && transferType === 'Savings Withdraw';
            const balanceValue =
                !asset || asset === 'STEEM'
                    ? isWithdraw
                        ? currentAccount.get('savings_balance')
                        : currentAccount.get('balance')
                    : asset === 'SBD'
                        ? isWithdraw
                            ? currentAccount.get('savings_sbd_balance')
                            : currentAccount.get('sbd_balance')
                        : asset === 'TRX'
                            ? this.props.tron_balance + ' TRX'
                            : null;
            if (!balanceValue) return false;
            const balance = balanceValue.split(' ')[0];
            return parseFloat(amount) > parseFloat(balance);
            // return parseFloat(balance) == 0.00 ? true: parseFloat(amount) > parseFloat(balance);
        };
        const tron_validation = address => {
            if (this.state.tron_transfer) {
                if (this.state.switchSteem) {
                    const text = validate_account_name(address);
                    if (text != null) return text;
                    this.props.checkTron({
                        username: address,
                        tron_address: null,
                    });
                    return null;
                }
                if (this.state.switchTron) {
                    if (address.length != 34)
                        return tt('transfer_jsx.invalid_tron_address');
                    this.props.checkTron({
                        username: null,
                        tron_address: address,
                    });
                    return null;
                }
            }
        };
        const { toVesting } = props;
        const fields = toVesting ? ['to', 'amount'] : ['to', 'amount', 'asset'];
        if (
            !toVesting &&
            transferType !== 'Transfer to Savings' &&
            transferType !== 'Savings Withdraw'
        )
            fields.push('memo');
        reactForm({
            name: 'transfer',
            instance: this,
            fields,
            initialValues: props.initialValues,
            validation: values => ({
                to: !values.to
                    ? tt('g.required')
                    : this.state.tron_transfer
                        ? tron_validation(values.to)
                        : validate_account_name_with_memo(
                              values.to,
                              values.memo
                          ),
                amount: !values.amount
                    ? 'Required'
                    : !/^\d+(\.\d+)?$/.test(values.amount)
                        ? tt('transfer_jsx.amount_is_in_form')
                        : insufficientFunds(values.asset, values.amount)
                            ? tt('transfer_jsx.insufficient_funds')
                            : countDecimals(values.amount) > 3
                                ? tt(
                                      'transfer_jsx.use_only_3_digits_of_precison'
                                  )
                                : null,
                asset: props.toVesting
                    ? null
                    : !values.asset
                        ? tt('g.required')
                        : null,
                memo: values.memo
                    ? validate_memo_field(
                          values.memo,
                          props.currentUser.get('username'),
                          props.currentAccount.get('memo_key')
                      )
                    : values.memo &&
                      (!browserTests.memo_encryption && /^#/.test(values.memo))
                        ? 'Encrypted memos are temporarily unavailable (issue #98)'
                        : null,
            }),
        });
    }

    clearError = () => {
        this.setState({ trxError: undefined });
        this.props.resetError();
    };

    errorCallback = estr => {
        this.setState({ trxError: estr, loading: false });
    };

    balanceValue() {
        const { transferType } = this.props.initialValues;
        const { currentAccount } = this.props;
        const { asset } = this.state;
        const isWithdraw = transferType && transferType === 'Savings Withdraw';
        return !asset || asset.value === 'STEEM'
            ? isWithdraw
                ? currentAccount.get('savings_balance')
                : currentAccount.get('balance')
            : asset.value === 'SBD'
                ? isWithdraw
                    ? currentAccount.get('savings_sbd_balance')
                    : currentAccount.get('sbd_balance')
                : asset.value === 'TRX'
                    ? this.props.tron_balance + ' TRX'
                    : null;
    }

    assetBalanceClick = e => {
        e.preventDefault();
        // Convert '9.999 STEEM' to 9.999
        this.state.amount.props.onChange(this.balanceValue().split(' ')[0]);
    };

    onChangeTo = value => {
        this.state.to.props.onChange(value.toLowerCase().trim());
        this.setState({
            to: { ...this.state.to, value: value.toLowerCase().trim() },
        });
    };

    componentDidUpdate(prevProps) {
        if (this.props.tron_transfer_msg !== prevProps.tron_transfer_msg) {
            this.setState({
                tron_transfer_msg: this.props.tron_transfer_msg,
                error: true,
                to: { ...this.state.to, error: this.props.tron_transfer_msg },
            });
        }
        if (this.props.to_tron_address !== prevProps.to_tron_address) {
            this.setState({
                to_tron_address: this.covertTronAddress(
                    this.props.to_tron_address
                ),
            });
        }
    }

    render() {
        const transferTips = {
            'Transfer to Account': tt(
                'transfer_jsx.move_funds_to_another_account',
                { APP_NAME }
            ),
            'Transfer to Savings': tt(
                'transfer_jsx.protect_funds_by_requiring_a_3_day_withdraw_waiting_period'
            ),
            'Savings Withdraw': tt(
                'transfer_jsx.withdraw_funds_after_the_required_3_day_waiting_period'
            ),
        };
        const powerTip3 = tt(
            'tips_js.converted_VESTING_TOKEN_can_be_sent_to_yourself_but_can_not_transfer_again',
            { LIQUID_TOKEN, VESTING_TOKEN }
        );
        const { to, amount, asset, memo } = this.state;
        const { loading, trxError, advanced } = this.state;
        const {
            currentUser,
            currentAccount,
            toVesting,
            transferToSelf,
            dispatchSubmit,
        } = this.props;
        const { transferType } = this.props.initialValues;
        const { submitting, valid, handleSubmit } = this.state.transfer;
        // const isMemoPrivate = memo && /^#/.test(memo.value); -- private memos are not supported yet
        const isMemoPrivate = false;

        const form = (
            <form
                onSubmit={handleSubmit(({ data }) => {
                    this.setState({ loading: true });
                    dispatchSubmit({
                        ...data,
                        errorCallback: this.errorCallback,
                        currentUser,
                        toVesting,
                        transferType,
                    });
                })}
                onChange={this.clearError}
            >
                {toVesting && (
                    <div className="row">
                        <div className="column small-12">
                            <p>{tt('tips_js.influence_token')}</p>
                            <p>
                                {tt('tips_js.non_transferable', {
                                    LIQUID_TOKEN,
                                    VESTING_TOKEN,
                                })}
                            </p>
                        </div>
                    </div>
                )}

                {!toVesting && (
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                {transferTips[transferType]}
                            </div>
                        </div>
                        <br />
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('transfer_jsx.from')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">@</span>
                            <input
                                className="input-group-field bold"
                                type="text"
                                disabled
                                value={currentUser.get('username')}
                            />
                            <span className="tron_address">
                                {' '}
                                {this.state.tron_address}
                            </span>
                        </div>
                    </div>
                </div>

                {advanced && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 5 }}
                        >
                            {tt('transfer_jsx.to')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                {this.state.switchSteem && (
                                    <span className="input-group-label">@</span>
                                )}
                                <Autocomplete
                                    wrapperStyle={{
                                        display: 'inline-block',
                                        width: '100%',
                                    }}
                                    inputProps={{
                                        type: 'text',
                                        className: 'input-group-field',
                                        autoComplete: 'off',
                                        autoCorrect: 'off',
                                        autoCapitalize: 'off',
                                        spellCheck: 'false',
                                        disabled: loading,
                                    }}
                                    renderMenu={items => (
                                        <div
                                            className="react-autocomplete-input"
                                            children={items}
                                        />
                                    )}
                                    ref={el => (this.to = el)}
                                    getItemValue={item => item.username}
                                    items={this.state.autocompleteUsers}
                                    shouldItemRender={
                                        this.matchAutocompleteUser
                                    }
                                    renderItem={(item, isHighlighted) => (
                                        <div
                                            className={
                                                isHighlighted ? 'active' : ''
                                            }
                                        >
                                            {`${item.username} (${item.label})`}
                                        </div>
                                    )}
                                    value={this.state.to.value || ''}
                                    onChange={e => {
                                        this.setState({
                                            to: {
                                                ...this.state.to,
                                                touched: true,
                                                value: e.target.value,
                                            },
                                        });
                                    }}
                                    onSelect={val =>
                                        this.setState({
                                            to: {
                                                ...this.state.to,
                                                value: val,
                                            },
                                        })
                                    }
                                />
                            </div>
                            {this.state.tron_transfer &&
                                this.state.switchSteem && (
                                    <button
                                        className="switch"
                                        onClick={e =>
                                            this.setState({
                                                switchTron: true,
                                                switchSteem: false,
                                            })
                                        }
                                    >
                                        switch to tron
                                    </button>
                                )}
                            {this.state.tron_transfer &&
                                this.state.switchTron && (
                                    <button
                                        className="switch"
                                        onClick={e =>
                                            this.setState({
                                                switchTron: false,
                                                switchSteem: true,
                                            })
                                        }
                                    >
                                        switch to steem
                                    </button>
                                )}
                            {to.touched && to.error ? (
                                <div className="error">{to.error}&nbsp;</div>
                            ) : (
                                <p>{toVesting && powerTip3}</p>
                            )}
                            {/* {this.state.tron_transfer_msg != '' && (
                                <div className="error">
                                    {this.state.tron_transfer_msg}
                                </div>
                            )} */}
                        </div>
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('g.amount')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: 5 }}
                        >
                            <input
                                type="text"
                                placeholder={tt('g.amount')}
                                {...amount.props}
                                ref="amount"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            {asset && (
                                <span
                                    className="input-group-label"
                                    style={{ paddingLeft: 0, paddingRight: 0 }}
                                >
                                    <select
                                        {...asset.props}
                                        placeholder={tt('transfer_jsx.asset')}
                                        disabled={loading}
                                        style={{
                                            minWidth: '5rem',
                                            height: 'inherit',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                        }}
                                        disabled={this.state.tron_transfer}
                                    >
                                        {!this.state.tron_transfer && (
                                            <option value="STEEM">STEEM</option>
                                        )}
                                        {!this.state.tron_transfer && (
                                            <option value="SBD">SBD</option>
                                        )}
                                        {this.state.tron_transfer && (
                                            <option value="TRX">TRX</option>
                                        )}
                                    </select>
                                </span>
                            )}
                        </div>
                        <div style={{ marginBottom: '0.6rem' }}>
                            <AssetBalance
                                balanceValue={this.balanceValue()}
                                onClick={this.assetBalanceClick}
                            />
                        </div>
                        {(asset && asset.touched && asset.error) ||
                        (amount.touched && amount.error) ? (
                            <div className="error">
                                {asset &&
                                    asset.touched &&
                                    asset.error &&
                                    asset.error}&nbsp;
                                {amount.touched &&
                                    amount.error &&
                                    amount.error}&nbsp;
                            </div>
                        ) : null}
                    </div>
                </div>

                {memo && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 33 }}
                        >
                            {tt('g.memo')}
                        </div>
                        <div className="column small-10">
                            <small>
                                {isMemoPrivate
                                    ? tt('transfer_jsx.this_memo_is_private')
                                    : tt('transfer_jsx.this_memo_is_public')}
                            </small>
                            <input
                                type="text"
                                placeholder={tt('g.memo')}
                                {...memo.props}
                                ref="memo"
                                autoComplete="on"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            <div className="error">
                                {memo.touched && memo.error && memo.error}&nbsp;
                            </div>
                        </div>
                    </div>
                )}
                <div className="row">
                    <div className="column">
                        {loading && (
                            <span>
                                <LoadingIndicator type="circle" />
                                <br />
                            </span>
                        )}
                        {!loading && (
                            <span>
                                {trxError && (
                                    <div className="error">{trxError}</div>
                                )}
                                <button
                                    type="submit"
                                    disabled={
                                        submitting ||
                                        !valid ||
                                        (this.state.tron_transfer &&
                                            this.state.error)
                                    }
                                    className="button"
                                >
                                    {toVesting
                                        ? tt('g.power_up')
                                        : tt('g.next')}
                                </button>
                                {transferToSelf && (
                                    <button
                                        className="button hollow no-border"
                                        disabled={submitting}
                                        onClick={this.onAdvanced}
                                    >
                                        {advanced
                                            ? tt('g.basic')
                                            : tt('g.advanced')}
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </form>
        );
        return (
            <div>
                <div className="row">
                    <h3 className="column">
                        {toVesting
                            ? tt('transfer_jsx.convert_to_VESTING_TOKEN', {
                                  VESTING_TOKEN,
                              })
                            : transferType}
                    </h3>
                </div>
                {form}
            </div>
        );
    }
}

const AssetBalance = ({ onClick, balanceValue }) => (
    <a
        onClick={onClick}
        style={{ borderBottom: '#A09F9F 1px dotted', cursor: 'pointer' }}
    >
        {tt('g.balance', { balanceValue })}
    </a>
);

import { connect } from 'react-redux';

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const initialValues = state.user.get('transfer_defaults', Map()).toJS();
        const toVesting = initialValues.asset === 'VESTS';
        const currentUser = state.user.getIn(['current']);
        const currentAccount = state.global.getIn([
            'accounts',
            currentUser.get('username'),
        ]);

        if (!toVesting && !initialValues.transferType)
            initialValues.transferType = 'Transfer to Account';

        let transferToSelf =
            toVesting ||
            /Transfer to Savings|Savings Withdraw/.test(
                initialValues.transferType
            );
        if (transferToSelf && !initialValues.to)
            initialValues.to = currentUser.get('username');

        if (initialValues.to !== currentUser.get('username'))
            transferToSelf = false; // don't hide the to field
        const tron_address =
            currentUser && currentUser.has('tron_address')
                ? currentUser.get('tron_address')
                : '';
        const tron_balance =
            currentUser && currentUser.has('tron_balance')
                ? currentUser.get('tron_balance')
                : '';
        const tron_transfer_msg =
            currentUser && currentUser.has('tron_transfer_msg')
                ? currentUser.get('tron_transfer_msg')
                : '';
        const to_tron_address =
            currentUser && currentUser.has('to_tron_address')
                ? currentUser.get('to_tron_address')
                : '';

        return {
            ...ownProps,
            currentUser,
            currentAccount,
            toVesting,
            transferToSelf,
            initialValues,
            following: state.global.getIn([
                'follow',
                'getFollowingAsync',
                currentUser.get('username'),
                'blog_result',
            ]),
            tron_address,
            tron_balance,
            tron_transfer_msg,
            to_tron_address,
        };
    },

    // mapDispatchToProps
    dispatch => ({
        dispatchSubmit: ({
            to,
            amount,
            asset,
            memo,
            transferType,
            toVesting,
            currentUser,
            errorCallback,
        }) => {
            if (
                !toVesting &&
                !/Transfer to Account|Transfer to Savings|Savings Withdraw/.test(
                    transferType
                )
            )
                throw new Error(
                    `Invalid transfer params: toVesting ${toVesting}, transferType ${transferType}`
                );

            const username = currentUser.get('username');
            const successCallback = () => {
                // refresh transfer history
                dispatch(
                    globalActions.getState({ url: `@${username}/transfers` })
                );
                if (/Savings Withdraw/.test(transferType)) {
                    dispatch(userActions.loadSavingsWithdraw({}));
                }
                dispatch(userActions.hideTransfer());
            };
            const asset2 = toVesting ? 'STEEM' : asset;
            const operation = {
                from: username,
                to,
                amount: parseFloat(amount, 10).toFixed(3) + ' ' + asset2,
                memo: toVesting ? undefined : memo ? memo : '',
            };
            const confirm = () => <ConfirmTransfer operation={operation} />;
            if (transferType === 'Savings Withdraw')
                operation.request_id = Math.floor(
                    (Date.now() / 1000) % 4294967295
                );
            dispatch(
                transactionActions.broadcastOperation({
                    type: toVesting
                        ? 'transfer_to_vesting'
                        : transferType === 'Transfer to Account'
                            ? 'transfer'
                            : transferType === 'Transfer to Savings'
                                ? 'transfer_to_savings'
                                : transferType === 'Savings Withdraw'
                                    ? 'transfer_from_savings'
                                    : transferType === 'tron_transfer'
                                        ? 'tron_transfer'
                                        : null,
                    operation,
                    successCallback,
                    errorCallback,
                    confirm,
                })
            );
        },
        checkTron: ({ username, tron_address }) => {
            dispatch(
                userActions.checkTron({
                    to_username: username,
                    to_tron_address: tron_address,
                })
            );
        },
        resetError: () => {
            dispatch(userActions.resetError());
        },
    })
)(TransferForm);
