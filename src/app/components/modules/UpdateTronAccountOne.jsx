import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
const styles = {
    step: {
        marginTop: '12px',
        marginLeft: '10%',
        frontSize: '20px',
    },
};
/*
    "update_tron_account":"UPDATE TRON ACCOUNT",
        "update_tron_content":"To update TRON account, please confirm following information so as to avoid potential risk. \n Save TRON private key locally or import this TRON account into other wallet supporting TRON. or transfer tron asset into other tron account. ",
        "update_button":"UPDATE AND DOWNLOAD",
        "update_success": "UPDATE SUCCESS",
        "update_success_content":" You successfully update your TRON account. If fail to download, please with TRON public key pdf file. please take care of this file, if loss, cannot get it back. please do not share with anyone",
        "update_success_click": "click download" 
*/
class UpdateTronAccountOne extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideUpdate();
            this.props.showUpdateSuccess();
        };
    }

    render() {
        return (
            <div>
                <div>
                    <h1>{tt('tron_jsx.update_tron_account')}</h1>
                </div>
                <div>{tt('tron_jsx.update_tron_content')}</div>
                <button
                    type="submit"
                    className="button"
                    onClick={this.handleSubmit}
                >
                    {tt('tron_jsx.update_button')}
                </button>
            </div>
        );
    }
}

export default connect(
    state => ({}),
    dispatch => ({
        showUpdateSuccess: () => {
            // if (e) e.preventDefault();
            // dispatch(userActions.hideUpdate());
            dispatch(userActions.showUpdateSuccess());
        },
        hideUpdate: () => {
            dispatch(userActions.hideUpdate());
        },
    })
)(UpdateTronAccountOne);
