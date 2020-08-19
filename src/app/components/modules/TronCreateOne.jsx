import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import { decryptedTronToken } from 'server/tronAccount';
import PdfDownload from 'app/components/elements/PdfDownload';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
    },
};

class TronCreateOne extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideTronCreate();
            this.props.showTronCreateSuccess();
            this.props.updateUser();
        };
    }

    render() {
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.create_tron_account')}</h3>
                </div>
                <div style={styles.container}>
                    {tt('tron_jsx.create_tron_account_content')}
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                    >
                        {tt('tron_jsx.create_tron_agree')}
                    </button>
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    state => ({}),
    dispatch => ({
        hideTronCreate: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideTronCreate());
        },
        showTronCreateSuccess: () => {
            dispatch(userActions.showTronCreateSuccess());
        },
        updateUser: () => {
            dispatch(
                userActions.updateUser({
                    claim_reward: false,
                    tron_address: '',
                })
            );
        },
    })
)(TronCreateOne);
